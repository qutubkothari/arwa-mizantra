import {
  getUserPermissions,
  hasAnyPermissionForResource,
} from "./permission-utils";

describe("permission utility module mapping", () => {
  it("maps Accounts module view access to accounting analytics", () => {
    const user = {
      permissions: [{ module: "Accounts", view: true }],
    };
    expect(getUserPermissions(user)).toContain("accounting:read");
    expect(hasAnyPermissionForResource(user, "accounting")).toBe(true);
  });

  it("maps Production and Projects without granting unrelated domains", () => {
    const user = {
      role: {
        permissions: [
          { module: "Production", view: true },
          { module: "Projects", view: true },
        ],
      },
    };
    expect(hasAnyPermissionForResource(user, "job_orders")).toBe(true);
    expect(hasAnyPermissionForResource(user, "projects")).toBe(true);
    expect(hasAnyPermissionForResource(user, "accounting")).toBe(false);
  });
});
