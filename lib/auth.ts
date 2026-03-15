import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";

const pickEnv = (...keys: string[]): string =>
  keys.map((key) => process.env[key]?.trim() || "").find(Boolean) || "";

const authSecret = pickEnv("AUTH_SECRET", "NEXTAUTH_SECRET");
const googleClientId = pickEnv("AUTH_GOOGLE_ID", "GOOGLE_CLIENT_ID", "GOOGLE_ID");
const googleClientSecret = pickEnv("AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_SECRET", "GOOGLE_SECRET");
const facebookClientId = pickEnv("AUTH_FACEBOOK_ID", "FACEBOOK_CLIENT_ID", "FACEBOOK_ID");
const facebookClientSecret = pickEnv(
  "AUTH_FACEBOOK_SECRET",
  "FACEBOOK_CLIENT_SECRET",
  "FACEBOOK_SECRET",
);
const appleClientId = pickEnv("AUTH_APPLE_ID", "APPLE_CLIENT_ID", "APPLE_ID");
const appleClientSecret = pickEnv("AUTH_APPLE_SECRET", "APPLE_CLIENT_SECRET", "APPLE_SECRET");

const providers: NextAuthOptions["providers"] = [];

if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (facebookClientId && facebookClientSecret) {
  providers.push(
    FacebookProvider({
      clientId: facebookClientId,
      clientSecret: facebookClientSecret,
    }),
  );
}

if (appleClientId && appleClientSecret) {
  providers.push(
    AppleProvider({
      clientId: appleClientId,
      clientSecret: appleClientSecret,
    }),
  );
}

// Keep an email fallback so the login page stays usable
// even when OAuth env vars are not configured yet.
providers.push(
  CredentialsProvider({
    name: "email-demo",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize(credentials) {
      const email = String(credentials?.email || "").trim();
      if (!email) {
        return null;
      }
      return {
        id: `demo_${email.toLowerCase()}`,
        name: email.split("@")[0] || "Designer",
        email,
        image: "https://picsum.photos/200",
      };
    },
  }),
);

export const authConfig: NextAuthOptions = {
  ...(authSecret ? { secret: authSecret } : {}),
  session: {
    strategy: "jwt",
  },
  providers,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.plan = "free";
        token.credits = 50;
      }
      return token;
    },
    session({ session, token }) {
      const typedUser = (session.user || {}) as {
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
        plan?: "free" | "pro" | "enterprise";
        credits?: number;
      };
      typedUser.id = String(token.sub || typedUser.id || "u_oauth");
      typedUser.plan =
        (token.plan as "free" | "pro" | "enterprise" | undefined) || typedUser.plan || "free";
      typedUser.credits =
        typeof token.credits === "number" ? token.credits : (typedUser.credits ?? 50);
      session.user = typedUser;
      return session;
    },
  },
};
