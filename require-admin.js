/** Gate for the admin-only APIs. Shared by the admin and finals routes. */
module.exports = function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
};
