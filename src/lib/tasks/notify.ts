export { TASK_REMINDER_RESET } from "@/lib/tasks/constants";

export async function notifyTaskAdvisor(
  taskId: string,
  reason: "due" | "reschedule" = "due",
): Promise<{
  ok: boolean;
  whatsapp?: boolean;
  email?: boolean;
  errors?: string[];
}> {
  const res = await fetch(`/api/tasks/${taskId}/remind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    whatsapp?: boolean;
    email?: boolean;
    errors?: string[];
  };
  return { ok: res.ok, ...body };
}
