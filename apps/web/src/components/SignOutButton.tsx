import { appSignOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={appSignOut}>
      <button
        type="submit"
        className="text-[11px] uppercase tracking-widest text-muted transition-colors hover:text-parchment"
      >
        Sign out
      </button>
    </form>
  );
}
