import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { orderedWaitingPrompts } from "@reactor/infinite-contracts";
import { animateQueueCount, hasQueueAddition, queuedPromptDescription, QUEUE_COUNT_DURATION_MS } from "../../../webapp/src/lib/queue-count";

const source = (path: string) => readFileSync(resolve("../../webapp/src", path), "utf8");
const ids = (states: [string, string][]) => orderedWaitingPrompts(states.map(([_id,status],createdAt)=>({_id,status,createdAt}))).map(p=>p._id);

test("schedule counts only waiting prompts and pulses on actual queue arrivals", () => {
  const initial = ids([["a","pending"],["b","queued"],["c","playing"],["d","played"]]);
  assert.equal(initial.length,2);
  assert.equal(hasQueueAddition(undefined,initial),false);
  assert.equal(hasQueueAddition([],initial),true);
  assert.equal(hasQueueAddition(initial,[...initial].reverse()),false);
  assert.equal(hasQueueAddition(initial,ids([["a","queued"],["b","queued"]])),false);
  assert.equal(hasQueueAddition(initial,ids([["a","queued"],["b","playing"]])),false);
  assert.equal(hasQueueAddition(initial,["a","new"]),true,"Replacement arrivals pulse even when the total stays constant");
  assert.equal(hasQueueAddition(initial,[]),false);
  assert.equal(hasQueueAddition(initial,undefined),false);
  const app = source("app/stream/broadcast-app.tsx");
  assert.ok(app.includes("const activePrompts = useQuery(api.prompts.active)"));
  assert.ok(app.includes("orderedWaitingPrompts(activePrompts).map(prompt => prompt._id)"));
  assert.ok(app.includes("queuedPromptIds={queuedPromptIds}"));
  assert.doesNotMatch(source("app/stream/schedule-queue-count.tsx"),/fetch\(|setInterval/);
});

function clock() {
  let now=0, nextId=0;
  const frames=new Map<number,(time:number)=>void>();
  const values:number[]=[];
  return {
    values,frames,
    options:{now:()=>now,requestFrame:(callback:(time:number)=>void)=>{frames.set(++nextId,callback);return nextId;},cancelFrame:(id:number)=>{frames.delete(id);},show:(value:number)=>{values.push(value);}},
    advance(ms:number) { now+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now)); },
  };
}

test("queue counts animate monotonically, land exactly, and stop scheduling", () => {
  const up=clock();animateQueueCount(0,10,up.options);
  up.advance(40);up.advance(60);up.advance(QUEUE_COUNT_DURATION_MS);
  assert.ok(up.values[0]>0 && up.values[0]<10);
  assert.equal(up.values.at(-1),10);
  assert.deepEqual([...up.values].sort((a,b)=>a-b),up.values);
  assert.equal(up.frames.size,0);
  const down=clock();animateQueueCount(10,0,down.options);
  down.advance(100);down.advance(QUEUE_COUNT_DURATION_MS);
  assert.ok(down.values[0]>0 && down.values[0]<10);
  assert.equal(down.values.at(-1),0);
});

test("rapid updates restart from the visible count and cancel stale frames", () => {
  const c=clock();const cancel=animateQueueCount(0,20,c.options);
  c.advance(30);const shown=c.values.at(-1)!;
  cancel();assert.equal(c.frames.size,0);
  animateQueueCount(shown,2,c.options);
  c.advance(0);assert.equal(c.values.at(-1),shown);
  c.advance(QUEUE_COUNT_DURATION_MS);assert.equal(c.values.at(-1),2);
  assert.equal(c.frames.size,0);
});

test("initial data and reduced motion settle without count-up or pulse", () => {
  const c=clock();animateQueueCount(0,99,{...c.options,immediate:true});
  c.advance(0);assert.deepEqual(c.values,[99]);assert.equal(c.frames.size,0);
  const component=source("app/stream/schedule-queue-count.tsx");
  assert.ok(component.includes("immediate: initial || preference.matches || start === target"));
  assert.ok(component.includes("if (!initial && !preference.matches)"));
  assert.ok(component.includes('preference.addEventListener("change", finish)'));
  assert.ok(component.includes('preference.removeEventListener("change", finish)'));
  assert.ok(component.includes("animations.forEach(animation => animation.cancel())"));
  assert.ok(component.includes("const start = displayed.current ?? target"));
  assert.ok(component.includes("requestFrame: callback => window.requestAnimationFrame(callback)"));
  assert.ok(component.includes("cancelFrame: frame => window.cancelAnimationFrame(frame)"));
});

test("schedule badge exposes the exact count separately from animated digits", async () => {
  const require=createRequire(resolve("../../webapp/package.json"));
  const {createElement}=require("react");const {renderToStaticMarkup}=require("react-dom/server");
  const built=await build({entryPoints:[resolve("../../webapp/src/app/stream/schedule-panel.tsx")],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",jsx:"automatic",alias:{"@":resolve("../../webapp/src")}});
  const module={exports:{} as {ScheduleButton:unknown}};
  new Function("require","module","exports",built.outputFiles[0].text)(require,module,module.exports);
  const render=(queuedPromptIds?:string[])=>renderToStaticMarkup(createElement(module.exports.ScheduleButton,{open:false,onClick:()=>{},queuedPromptIds}));
  for (const count of [0,1,12,100]) {
    const html=render(Array.from({length:count},(_,i)=>String(i)));
    assert.ok(html.includes(queuedPromptDescription(count)));
    assert.match(html,/aria-label="View Schedule"/);
    assert.match(html,/aria-describedby="[^"]+"/);
    assert.match(html,/class="schedule-queue-count" aria-hidden="true"/);
    assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);
    assert.ok(html.includes("<span>"+count+"</span>"));
  }
  const loading=render();
  assert.ok(loading.includes("Loading prompt queue"));assert.ok(loading.includes('data-loading="true"'));
  assert.ok(!loading.includes("0 prompts queued"));
});
