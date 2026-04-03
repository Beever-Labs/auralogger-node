export async function parseErrorBody(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return `Request failed with status ${response.status}.`;
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string" &&
    (body as { error: string }).error.trim()
  ) {
    return (body as { error: string }).error.trim();
  }

  return `Request failed with status ${response.status}.`;
}
