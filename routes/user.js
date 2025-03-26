const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /user/{id}:
 *   get:
 *     summary: Retrieve a user by ID (param)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: The user ID received
 */
router.get('/user/:id', (req, res) => {
    res.json({ param: req.params.id });
});

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Search users using query parameters
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: User name
 *       - in: query
 *         name: age
 *         schema:
 *           type: integer
 *         description: User age
 *     responses:
 *       200:
 *         description: Query parameters received
 */
router.get('/search', (req, res) => {
    res.json(req.query);
});

module.exports = router;
