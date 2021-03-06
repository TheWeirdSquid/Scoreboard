var express = require('express')
var router = express.Router()
var MongoClient = require('mongodb').MongoClient;
var validation = require('../extras/validation');
var databaseTools = require('../extras/database-tools');

const requireAuth = (req, res, next) => {
    if (req.user) {
        next();
    } else {
        if (req.method == "GET") {
            res.redirect(`/login?to=${encodeURIComponent(req.originalUrl)}`)
        }
        else {
            res.status(401).send('Invalid authorization token');
        }
    }
};

router.get('/', requireAuth, async function (req, res) {

    var confirm = req.query.confirm == 'false' ? false : true

    databaseTools.run(req, res, async (client) => {

        var teams = await databaseTools.teams(client).find({}).sort({'id': 1, '_id': 1}).toArray();

        var scoreLabel = process.env.SCORE_LABEL || 'Score';

        res.render('teams', {
            title: 'Teams',
            teams: teams,
            user: req.user,
            confirm: confirm,
            nonce: res.locals.nonce,
            scoreLabel: scoreLabel
        });
    });
})

router.get('/newteam', requireAuth, function (req, res) {
    res.render('newteam', {
        title: 'New Team',
        user: req.user,
        nonce: res.locals.nonce
    });
})

router.post('/newteam', requireAuth, async function (req, res) {

    var name = req.body.name;
    var id = req.body.id;
    var score = String(req.body.score);

    // verify all arguments exist
    if (!validation.exists([name, id, score], res)) { return }

    // validate arguments by criteria
    if (!validation.teamName(name, res)) { return }
    if (!validation.teamID(id, res)) { return }
    if (!validation.teamScore(score, res)) { return }

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client);

        // check if team already exists (based on id parameter)
        var matchingTeam = await teams.findOne({id: id})
        if (matchingTeam != null) {
            res.status(409).send(`A team with the identifier ${id} already exists`)
            return
        }
        var randomNumber;
        var unique = false;
        while (!unique) {
            // generate new number
            randomNumber = ''
            for (var i = 0; i < 6; i++) {
                randomNumber += Math.floor(Math.random() * 10)
            }
            // check if unique
            var matchingRand = await teams.findOne({password: randomNumber});
            if (matchingRand == null) {
                unique = true;
            }
        }

        const doc = {
            name: name,
            id: id,
            score: parseInt(score),
            password: randomNumber
        };
        const result = await teams.insertOne(doc);

        if (result.insertedCount == 0) {
            res.status(500).send('Failed to insert team into database');
        } else {

            // update clients
            var io = req.app.get('io');
            io.emit('scoreboard-update');

            res.status(201).send('ok');
        }
    });
})

router.post('/removeteam', requireAuth, async (req, res) => {
    var id = req.body.id;

    if (!validation.exists([id], res)) { return }
    if (!validation.teamID(id, res)) { return }

    id = id.toString();

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client);

        var match = await teams.findOne({id: id});

        if (match == null) {
            res.status(404).send(`No team with id ${id}.`);
            return;
        }

        const result = await teams.deleteOne({id: id});

        if (result.deletedCount == 0) {
            res.status(500).send('Failed to delete');
        } else {
            // update clients
            var io = req.app.get('io');
            io.emit('scoreboard-update');

            res.status(200).send('ok');
        }
    });
})

router.get('/editteam', requireAuth, async (req, res) => {

    var id = req.query.id;

    if (id == undefined) {
        res.status(400).send('Must include id parameter.');
        return;
    }

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client);

        var team = await teams.findOne({'id': id});

        if (team == undefined || team == null) {
            res.status(404).send("Team with identifier \"" + id + "\" doesn't exist.");
            return;
        }

        res.status(200).render('editteam', {
            title: 'Edit Team',
            user: req.user,
            team: team,
            nonce: res.locals.nonce
        });
    });
});

router.post('/editteam', requireAuth, async (req, res) => {

    var name = req.body.name;
    var id = req.body.id;
    var oldId = req.body.oldId;

    if (!validation.exists([id, name, oldId], res)) { return }

    name = String(name)
    id = String(id)
    oldId = String(oldId)

    if (!validation.teamName(name, res)) { return }
    if (!validation.teamID(id, res)) { return }
    if (!validation.teamID(oldId, res, 'oldId')) { return }

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client);
    
        var matchingTeam = await teams.findOne({'id': id});

        if (matchingTeam != null && id != oldId) {
            res.status(409).send('ID in use');
            return;
        }

        const result = await teams.updateOne({'id': oldId}, { $set: {'id': id, 'name': name} });

        if (result.matchedCount == 0) {
            res.status(500).send('Failed to update.');
        } else if (result.modifiedCount == 0) {
            res.sendStatus(304);
        } else {
            res.status(200).send('ok');

            // update clients
            var io = req.app.get('io');
            io.emit('scoreboard-update');
        }
    });
});

router.get('/changescore', requireAuth, async (req, res) => {

    var id = req.query.id || '';

    if (typeof(id) != String) {
        id = '';
    }

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client).find().sort({'id': 1}).toArray();

        res.status(200).render('changescore', {
            title: 'Change Score',
            user: req.user,
            teams: teams,
            selectedTeamId: id.toString(),
            nonce: res.locals.nonce
        });
    });
})

router.post('/changescore', requireAuth, async (req, res) => {

    var id = req.body.id;
    var score = req.body.score;

    if (!validation.exists([id, score], res)) { return }
    if (!validation.teamID(id, res)) { return }
    if (!validation.teamScore(score, res)) { return }

    databaseTools.run(req, res, async (client) => {
        var teams = databaseTools.teams(client);

        var result = await teams.updateOne({'id': id}, { $set: {'score': parseInt(score)}});

        if (result.matchedCount == 0) {
            res.status(404).send('No team with that ID');
        } else if (result.modifiedCount == 0) {
            res.sendStatus(304); // not modified
        } else {
            res.status(200).send('ok');

            // update clients
            var io = req.app.get('io');
            io.emit('scoreboard-update');
        }
    });
})

module.exports = router