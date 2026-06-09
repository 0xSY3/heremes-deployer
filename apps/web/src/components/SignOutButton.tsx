import { appSignOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={appSignOut}>
      <button
        type="submit"
        className="rounded-lg border border-panel-edge px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-panel-edge-2 hover:text-parchment"
      >
        Sign out
      </button>
    </form>
  );
}
