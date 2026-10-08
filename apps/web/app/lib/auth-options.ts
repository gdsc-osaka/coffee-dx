import { username } from "better-auth/plugins";

// CLI と Worker が同じ認証スキーマを使う。
export function createAuthOptions() {
  return {
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
    },
    disabledPaths: ["/is-username-available"],
    plugins: [username()],
    user: {
      additionalFields: {
        role: {
          type: "string" as const,
          required: false,
          defaultValue: "staff",
          input: false,
        },
        isActive: {
          type: "boolean" as const,
          required: false,
          defaultValue: true,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 43_200,
    },
  };
}
