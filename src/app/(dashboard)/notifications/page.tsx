"use client";

import { redirect } from "next/navigation";

/** Notifications live in the header bell popover — keep this route as a soft landing. */
export default function NotificationsRedirectPage() {
  redirect("/dashboard");
}
