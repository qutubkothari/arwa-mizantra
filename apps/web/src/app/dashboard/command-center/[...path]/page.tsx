import { redirect } from "next/navigation";

// The legacy Command Center was retired as a tenant-configurable surface.
// Preserve existing links and in-progress browser sessions by returning users
// to the deployed dashboard, which will then apply their normal role routing.
export default function LegacyCommandCenterRedirect() {
  redirect("/dashboard");
}
