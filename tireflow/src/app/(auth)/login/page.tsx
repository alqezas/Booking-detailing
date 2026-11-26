import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getUser } from "@/lib/auth";
import { Logo } from "@/components/app/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getUser()) redirect("/");
  const t = await getTranslations("auth");
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-10" />
        <h1 className="text-xl font-semibold tracking-tight">{t("signInTitle")}</h1>
      </div>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </div>
  );
}
