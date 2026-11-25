export function getOrganisationDetails(db, organisationId) {
  const org = db
    .prepare('SELECT id, slug, name, region, created_at FROM organisations WHERE id = ?')
    .get(organisationId);

  if (!org) return null;

  const members = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.title, u.department, u.is_demo, u.is_active,
              GROUP_CONCAT(r.name, ',') AS role_names
       FROM users u
       LEFT JOIN role_assignments ra ON ra.user_id = u.id AND ra.organisation_id = u.organisation_id
       LEFT JOIN roles r ON r.id = ra.role_id
       WHERE u.organisation_id = ?
       GROUP BY u.id
       ORDER BY u.display_name ASC`,
    )
    .all(organisationId);

  return {
    organisation: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      region: org.region,
      createdAt: org.created_at,
    },
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      displayName: m.display_name,
      title: m.title,
      department: m.department,
      isDemo: Boolean(m.is_demo),
      isActive: Boolean(m.is_active),
      roles: m.role_names ? String(m.role_names).split(',') : [],
    })),
  };
}
