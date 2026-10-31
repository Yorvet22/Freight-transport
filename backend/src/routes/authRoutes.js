const express = require('express');

function createAuthRoutes(controller, { authenticate }) {
  const router = express.Router();
  router.post('/login', express.json(), controller.login);
  router.post('/logout', authenticate, controller.logout);
  router.get('/me', authenticate, controller.me);
  return router;
}

module.exports = createAuthRoutes;
