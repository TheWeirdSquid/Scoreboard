require('dotenv').config() // configure environment variables
var createError = require('http-errors');
var express = require('express');
var session = require('express-session');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var sassMiddleware = require('node-sass-middleware');
const helmet = require('helmet');
var uuid = require('uuid').v4
var MongoClient = require('mongodb').MongoClient;
var crypto = require('crypto');
var bcrypt = require('bcrypt');

const generateAuthToken = () => {
  return crypto.randomBytes(30).toString('hex');
}

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var toolsRouter = require('./routes/teams');
var apiRouter = require('./routes/api');
const { isObject } = require('util');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.set('generateAuthToken', generateAuthToken);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(sassMiddleware({
  src: path.join(__dirname, 'public'),
  dest: path.join(__dirname, 'public'),
  indentedSyntax: true, // true = .sass and false = .scss
  sourceMap: true
}));
app.use((req, res, next) => {
  res.locals.nonce = uuid();
  next();
})
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "connect-src": ["'self'", "wss:"],
      "script-src": ["'self'", (req, res) => `'nonce-${ res.locals.nonce }'`],
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(async function(req, res, next) {
  if (req.cookies["AuthToken"] != null && req.cookies["AuthToken"] != undefined) {
    var authToken = req.cookies["AuthToken"]
  } else if (req.headers.authorization != null && req.headers.authorization != undefined) {
    var fullAuthToken = req.headers.authorization;
    let match = fullAuthToken.match(/^(?<type>\w*) (?<token>\S*)$/);

    if (match == null || match == undefined) {
      res.status(401).send('Invalid authorization header.');
      return;
    }

    var type = match.groups.type;
    var authToken = match.groups.token;

    if (type != 'Bearer' && req.path != '/token') {
      res.status(401).send('Invalid authorization type.');
      return;
    }
    if (authToken == null) {
      res.status(401).send('No authorization token.');
      return;
    }
  } else {
    req.user == null;
    next();
    return;
  }
  var client = new MongoClient(app.get('databaseUrl'))
  try {
    await client.connect()
    var users = client.db('scoreboard').collection('users')
    var user = await users.findOne({'token': authToken})
    if (user == undefined) {
      user = null;
    }
    req.user = user;
    next()
  }
  catch (e) {
    console.dir(e)
    req.user = null;
    next()
  }
  finally {
    client.close()
  }
})

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/teams', toolsRouter);
app.use('/api', apiRouter);

app.get('/login', function(req, res) {
  var toURL = req.query.to || encodeURIComponent('/')

  if (req.user != null) {
    res.redirect(decodeURIComponent(toURL));
  } else {
    res.render('login', {
      title: 'Login',
      forwardURL: decodeURIComponent(toURL),
      user: req.user,
      nonce: res.locals.nonce
    })
  }
})

app.post('/login', async function(req, res) {
  var client = new MongoClient(app.get('databaseUrl'))
  const {username, password, forwardURL} = req.body;

  // BOTH THE CLIENT AND SERVER MUST SHARE THESE ERROR CODES FOR THIS FUNCTION
  // ERROR CODE SET 002
  // Location for client: /views/login.pug
  const errorCode = {
    INVALID_USER: 'invalid_user',
    INCORRECT_PASSWORD: 'incorrect_password',
    DATABASE_ERROR: 'database_error'
  }

  try {
    await client.connect();

    var users = client.db('scoreboard').collection('users');
    var user = await users.findOne({'username': username});
    if (user == null) {
      res.json({
        ok: false,
        reason: 'No user with that name',
        errorCode: errorCode.INVALID_USER
      })
      return
    }
    
    var match = await bcrypt.compare(password, user.password)

    if (match) {

      const authToken = generateAuthToken()

      await users.updateOne({'username': username}, {$set: {'token': authToken}})

      res.cookie('AuthToken', authToken);

      console.log(`New token generated for user ${username} via /login`);

      res.json({
        ok: true
      })

    } else {
      res.json({
        ok: false,
        reason: 'Incorrect password',
        errorCode: errorCode.INCORRECT_PASSWORD
      })
      return
    }
  }
  catch (e) {
    console.dir(e)
  }
  finally {
    await client.close()
  }
})

app.post('/token', async function(req, res) {

  if (req.user) { // user object is here, user is already authenticated so refuse to issue new token
    res.status(406).send('Already authorized');
    return;
  }

  // otherwise, get username and password from basic auth header
  var authHeader = req.headers.authorization;
  let match1 = authHeader.match(/^(?<type>\w*) (?<token>\S*)$/);

  if (match1 == null || match1 == undefined) {
    res.status(401).send('Invalid authorization header.');
    return;
  }

  var type = match1.groups.type;
  var authToken = match1.groups.token;

  if (type != 'Basic') {
    res.status(401).send('Invalid authorization type.');
    return;
  }
  if (authToken == null) {
    res.status(401).send('No authorization token.');
    return;
  }

  let buff = Buffer.from(authToken, 'base64');
  let decoded = buff.toString('ascii');

  var match2 = decoded.match(/^(?<username>.*?):(?<password>.*)$/);

  if (match2 == null) {
    res.status(401).send('Invalid basic token syntax.');
    return;
  }

  var username = match2.groups.username;
  var password = match2.groups.password;
  
  var client = new MongoClient(app.get('databaseUrl'))

  try {
    await client.connect();

    var users = client.db('scoreboard').collection('users');
    var user = await users.findOne({'username': username});
    if (user == null) {
      res.status(401).send('No matching user.')
      return
    }
    
    var match = await bcrypt.compare(password, user.password)

    if (match) {

      const authToken = generateAuthToken()

      await users.updateOne({'username': username}, {$set: {'token': authToken}})

      console.log(`New token generated for user ${username} via /token`);
      res.status(200).send(authToken);

    } else {
      res.status(401).send('Incorrect password.')
      return
    }
  }
  catch (e) {
    console.dir(e)
  }
  finally {
    await client.close()
  }
})

app.get('/logoff', (req, res) => {
  var io = req.app.get('io');
  var user = req.user;

  res.clearCookie('AuthToken');

  if (user != null && user != undefined) {
    if (user.sockets != undefined) {
      for (socketId of user.sockets) {
        io.to(socketId).emit('logoff');
        console.log(`Sent logoff event to socket ${socketId}`);
      }
    }
  }

  res.redirect('/');
})

app.get('/favicon.ico', (req, res) => {
  res.redirect('/images/favicon.ico');
})

app.get('/secret', (req, res) => {
  res.redirect('https://www.youtube.com/watch?v=dQw4w9WgXcQ'); // :)
})

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;