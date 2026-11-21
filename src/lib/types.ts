export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_thumb_path: string | null;
  email_display: string | null;
  locale: string;
  timezone: string;
  status: "active" | "deactivated";
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  legal_entity_code: string | null;
  base_currency: string;
  timezone: string;
  country: string;
  status: "active" | "suspended";
};

export type MembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  employee_number: string | null;
  department_id: string | null;
  job_title: string | null;
  manager_membership_id: string | null;
  start_date: string | null;
  status: "active" | "suspended" | "deactivated";
  deactivated_at: string | null;
  created_at: string;
};

export type OrgSettingsRow = {
  organization_id: string;
  mfa_required_for_sensitive: boolean;
  invitation_expiry_days: number;
  directory_show_email: boolean;
  /** Optional systems-integration toolkit (site schedules, drawings, QR labels) on projects. */
  site_toolkit_enabled: boolean;
};

export type MyOrganization = {
  organization_id: string;
  name: string;
  slug: string;
  membership_id: string;
  membership_status: MembershipRow["status"];
  organization_status: OrganizationRow["status"];
};
