// Jest globalTeardown: nothing to clean up. The test database is kept (tests truncate it) so reruns are fast;
// each test file closes its own pool with closeTestPool().
module.exports = async function globalTeardown() {};
