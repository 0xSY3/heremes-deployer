import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";

// Expose a stable user id on the session (Auth.js omits it by default).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust Vercel's proxy host header so callback URLs use the real domain, not localhost.
  trustHost: true,
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      // `user` is only set on first sign-in.
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      // token.sub is Google's stable subject id; token.id mirrors it.
      session.user.id = (token.id as string | undefined) ?? token.sub!;
      return session;
    },
  },
});
