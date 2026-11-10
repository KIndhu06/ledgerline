async function logAudit(db, actorId, action, details = {}) {
  await db.query(
    'INSERT INTO audit_log (actor_id, action, details) VALUES ($1, $2, $3)',
    [actorId, action, JSON.stringify(details)]
  );
}

module.exports = { logAudit };