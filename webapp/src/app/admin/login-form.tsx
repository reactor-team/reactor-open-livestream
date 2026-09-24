"use client";

import { useActionState } from "react";

import { login, type AdminActionState } from "./actions";

const initialState: AdminActionState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className="admin-login-form">
      <label htmlFor="admin-password">Control room password</label>
      <div className="admin-password-row">
        <input
          autoComplete="current-password"
          autoFocus
          id="admin-password"
          name="password"
          placeholder="Enter password"
          required
          type="password"
        />
        <button disabled={pending} type="submit">
          {pending ? "Opening" : "Enter control room"}
        </button>
      </div>
      {state.error ? <p className="admin-form-error">{state.error}</p> : null}
    </form>
  );
}
