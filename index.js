var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');
var expressValidator = require('express-validator');
var mongojs = require('mongojs');
var db = mongojs('customerapp', ['users', 'rounds', 'tickets', 'last_rounds', 'last_ticketid']);
var ObjectId = mongojs.ObjectId;
var app = express();
var io  = require('socket.io').listen(app.listen(3000));
var moment = require('moment');
var rng = require('mersennetwister');

//var exec = require('child_process').exec;

//var command = exec('cat /tmp/print_test.txt > /dev/usb/lp0', function(error, stdout, stderr) {
//    console.log('stdout: ' + stdout);
//    console.log('stderror: ' + stderr);
//
//    if(error !== null) {
//        console.log('exec error: ' + error);
//    }
//});

//command();

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body Parser Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

// Set Static Path
app.use(express.static(path.join(__dirname, 'public')));

// Global Variables
app.use(function(req, res, next) {
    res.locals.errors = null;
    next();
});

// Express Validator Middleware
app.use(expressValidator({
    errorFormatter: function(param, msg, value) {
        var namespace = param.split('.')
            , root    = namespace.shift()
            , formParam = root;

        while(namespace.length) {
            formParam += '[' + namespace.shift() + ']';
        }
        return {
            param : formParam,
            msg   : msg,
            value : value
        };
    }
}));

app.get('/', function(req, res){
    db.users.find(function (err, docs) {
        res.render('index', {
            title: 'Customers',
            users: docs
        });
    })
});

app.post('/ticket_add/:numbers', function(req, res) {
    var numbers = req.params.numbers;
    console.log(numbers + ' ' + typeof numbers);

    var ticketObj = null;

    //GET LAST TICKET ID FROM last_ticketid COLLECTION
    db.last_ticketid.find(
        function(err, doc) {
            if(err) {
                console.log('db.last_ticketid.findOne error: ' + err);
            } else {
                console.log(doc[0]);
                ticketObj = {
                    ticket_id: doc[0].ticket_id,
                    numbers: numbers,
                    round: round + 1,
                    datetime: moment().format(),
                    status: 'IN PLAY'
                };

                var responseObj = {
                    status: '',
                    message: ''
                };

                if(ticketObj.numbers.length < 6) {
                    responseObj.status = 'error';
                    responseObj.message = 'You must select all 6 numbers!';
                } else {
                    console.log(JSON.stringify(ticketObj));

                    //INSERT NEW TICKET
                    if(ticketObj.ticket_id) {
                        db.tickets.insert({
                            ticket_id: ticketObj.ticket_id,
                            numbers: ticketObj.numbers,
                            round: ticketObj.round,
                            datetime: ticketObj.datetime,
                            status: ticketObj.status
                        });

                        responseObj.status = 'success';
                        responseObj.message = 'Ticket added successfully!';

                        res.send(JSON.stringify(responseObj));

                        setTimeout(function() {
                            sendRecentTickets();
                        }, 1000);

                        //UPDATE LAST TICKET ID WITH INCREMENT
                        db.last_ticketid.update(
                            {
                                ticket_id: ticketObj.ticket_id
                            },
                            {
                                $set: {
                                    ticket_id: ticketObj.ticket_id + 1
                                },
                                $currentDate: { lastModified: true }
                            }
                        );
                    }
                }
            }
        }
    );
});

// -------- THE GAME -------
var round;
var lastRoundsNum = 11;
var dbRecord;

var lastRound = {
    round: 0,
    date: '',
    drawn_numbers: '',
    finished: false,
    dbFetch: false
};

var resolvedTickets = [];

io.sockets.on('connection', function(socket) {
    socket.emit('message', {message: 'connected to port 3000'});
    sendState();
    sendRoundResults(lastRoundsNum);
    sendRecentTickets();
});

//CONFIG
var drawParams = {
    numberLimit: 35,
    numbers: [
         1,  2,  3,  4,  5,  6,  7,  8,
         9, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31, 32,
        33, 34, 35, 36, 37, 38, 39, 40,
        41, 42, 43, 44, 45, 46, 47, 48],
    drawnNumbers: [],
    intervalTime: 1000,
    interval: null
};

function sendState() {
        var state = {
            round: round,
            drawn_numbers: checkForDrawnNumbers()
        };

        io.sockets.emit('state', {state: state});
}

function checkForDrawnNumbers() {
    console.log('drawParams.drawnNumbers: ' + drawParams.drawnNumbers);
    var drawn = [];
    for(var i = 0; i < drawParams.drawnNumbers.length; i++) {
        drawn.push({
            index: i + 1,
            value: drawParams.drawnNumbers[i]
        });
    }

    return drawn;
}

function sendRoundResults(roundLimit) {
    if(roundLimit === undefined) {
        roundLimit = 10;
    }

    db.rounds.find().sort({_id: -1}).limit(roundLimit).toArray(function(err, docs) {
        io.sockets.emit('round_results', {results: docs});
    });
}

function sendRecentTickets() {
    db.tickets.find().sort({_id: -1}).limit(10).toArray(function(err, docs) {
        //console.log(JSON.stringify(docs));

        io.sockets.emit('recent_tickets', {recent_tickets: docs});
    });
}

function resetNumbersDraw() {
    drawParams.drawnNumbers = [];
}

function startNumbersDraw() {
    var d = drawParams;

    d.interval = setInterval(function() {
        if(d.drawnNumbers.length != d.numberLimit) {
            drawNumber();
        } else {
            //FINISH ROUND
            dbRecord.updateRoundDatetimeEnd();

            //RESOLVE ROUND TICKETS
            var currentRound = round;
            resolveRoundTickets(currentRound);

            //PREPARE AND START NEXT ROUND
            round++;
            resetNumbersDraw();
            io.sockets.emit('round', {round: round});
            dbRecord = createDBRecord();
            sendRoundResults(lastRoundsNum);
        }
    }, d.intervalTime);
}

function drawNumber() {
    var d = drawParams;
    var numberDrawn = false;

    var attemptDraw = function() {
        var number = d.numbers[Math.floor(rng.random() * d.numbers.length)];

        if(d.drawnNumbers.indexOf(number) == -1) {
            d.drawnNumbers.push(number);
            dbRecord.updateNumbersAndRound();
            numberDrawn = true;

            io.sockets.emit('number', {
                index: d.drawnNumbers.length,
                value: number
            });
        }
    };

    while(!numberDrawn) {
        attemptDraw();
    }
}

function startDrawingRound() {
    resetNumbersDraw();
    startNumbersDraw();
    dbRecord = createDBRecord();
}

function createDBRecord(dbFetchData) {
    var dbObj = {
        uuid            : dbFetchData ? dbFetchData.uuid            : generateUUID(),
        round           : dbFetchData ? dbFetchData.round           : round,
        numbers         : dbFetchData ? dbFetchData.numbers         : '',
        datetime_start  : dbFetchData ? dbFetchData.datetime_start  : moment().format(),
        datetime_end    : dbFetchData ? dbFetchData.datetime_end    : '',
        updateNumbersAndRound: function() {
            db.rounds.update(
                {
                    uuid: this.uuid
                },
                {
                    $set: {
                        numbers: drawParams.drawnNumbers.join(','),
                        round: round
                    },
                    $currentDate: { lastModified: true }
                }
            );
        },

        updateRoundDatetimeEnd: function() {
            db.rounds.update(
                {
                    uuid: this.uuid
                },
                {
                    $set: { datetime_end: moment().format() },
                    $currentDate: { lastModified: true }
                }
            );
        }
    };

    db.rounds.insert({
        uuid: dbObj.uuid,
        round: dbObj.round,
        numbers: dbObj.numbers,
        datetime_start: dbObj.datetime_start,
        datetime_end: dbObj.datetime_end
    });

    setLastRound();

    return dbObj;
}


function generateUUID() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

function setLastRound() {
    var currentDate = new Date().toJSON().slice(0, 10);

    try {
        db.last_rounds.find({date: currentDate}).toArray(function(err, docs) {
            if(err) {
            } else if(docs.length != 0) {
                db.last_rounds.update(
                    {
                        date: currentDate
                    },
                    {
                        $set: { round: round },
                        $currentDate: { lastModified: true }
                    }
                );
            } else {
                db.last_rounds.insert({
                    round: round,
                    date: currentDate
                });
            }
        });
    } catch(e) {
        console.log('error finding last_rounds');
    }
}

function fetchLastRound() {
    var currentDate = new Date().toJSON().slice(0, 10);

    db.last_rounds.find({date: currentDate}).toArray(function(err, docs) {
        if(err) {
            console.log('fetch last_round error: ' + err);
        } else {
            if(docs.length) {
                round = docs[0].round;

                lastRound.round = docs[0].round;
                lastRound.date = docs[0].date;
                lastRound.dbFetch = true;

                console.log('###fetchLastRound### ' + JSON.stringify(lastRound));
            } else {
                console.log('no last round');
            }
        }
    });
}

function fetchLastRoundDraw(useAsDBRecordParams) {
    if(useAsDBRecordParams == undefined) {
        useAsDBRecordParams = false;
    }

        if(lastRound.round) {
            db.rounds.find({
                round: lastRound.round,
            }).toArray(function(err, docs) {
                if(err) {
                    //console.log('fetchLastRoundDraw query error: ' + err);
                } else {
                    //console.log('fetchLastRoundDraw query result: ' + JSON.stringify(docs));
                    if(docs.length) {
                        for(var i = 0; i < docs.length; i++) {
                            //console.log('fetchLastRoundDraw index: ' + JSON.stringify(docs[i]));
                            if(lastRound.round == docs[i].round && moment(docs[i].datetime_start).format().indexOf(lastRound.date) != -1) {
                                //console.log('~~~ useAsDBRecordParams: ' + useAsDBRecordParams);
                                if(useAsDBRecordParams) {
                                    //console.log('### useAsDBRecordParams ###');
                                    dbRecord = createDBRecord({
                                        uuid: docs[i].uuid,
                                        round: docs[i].round,
                                        numbers: docs[i].numbers,
                                        datetime_start: docs[i].datetime_start,
                                        datetime_end: docs[i].datetime_end
                                    });
                                } else {
                                    //console.log('fetchLastRoundDraw match: ' + JSON.stringify(docs[i]));

                                    lastRound.drawn_numbers = String(docs[i].numbers).split(',');

                                    if(docs[0].numbers.split(',').length == 35) {
                                        lastRound.finished = true;
                                    }

                                    //console.log('lastRound.drawn_numbers: ' + lastRound.drawn_numbers);

                                    drawParams.drawnNumbers = lastRound.drawn_numbers;

                                }

                                break;
                            }
                        }
                    } else {
                        //TODO: console log something
                        //SET LAST ROUND AS FINISHED IN ORDER TO TRIGGER A START OF THE NEXT ROUND
                        lastRound.finished = true;
                    }
                }
            });

        }
}

function resolveRoundTickets(round) {
    var resolvedTicketObj;
    var roundNumbersArr;

    db.tickets.find({round: round}).sort({_id: -1}).toArray(function(err, ticketsDoc) {
        console.log('A');
        db.rounds.find({round: round}).sort({_id: -1}).toArray(function(err, roundsDoc) {
            console.log('B');
            for(var i = 0; i < roundsDoc.length; i++){
                console.log('C');
                if(roundsDoc[i].datetime_start.slice(0, 10) == moment().format().slice(0, 10)) {
                    console.log('D');
                    console.log(JSON.stringify(roundsDoc));
                    roundNumbersArr = roundsDoc[i].numbers.split(',');

                    for(var j = 0; j < ticketsDoc.length; j++) {
                        console.log('E');
                        console.log('====================');
                        console.log(ticketsDoc[j].round);
                        console.log(roundsDoc[i].round);
                        console.log(roundNumbersArr.length);
                        console.log('====================');

                        if(ticketsDoc[j].round == roundsDoc[i].round && roundNumbersArr.length == 35) {
                            console.log('F');
                            resolvedTicketObj = {};
                            resolvedTicketObj.ticket_id = ticketsDoc[j].ticket_id;
                            resolvedTicketObj.numbers = ticketsDoc[j].numbers.split(',');
                            resolvedTicketObj.numbers_hit = [];

                            for(var k = 0; k < roundNumbersArr.length; k++) {
                                console.log('G');
                                if(resolvedTicketObj.numbers.indexOf(roundNumbersArr[k]) != -1) {
                                    console.log('H');
                                    resolvedTicketObj.numbers_hit.push(roundNumbersArr[k]);
                                }
                            }

                            //RESOLVE STATUS
                            if(resolvedTicketObj.numbers_hit.length == 6) {
                                console.log('I');
                                resolvedTicketObj.status = 'WON';
                            } else {
                                console.log('J');
                                resolvedTicketObj.status = 'LOST';
                            }

                            //PUSH INTO RESOLVED ARRAY
                            console.log('K');
                            resolvedTickets.push(resolvedTicketObj);
                        }
                    }

                    //UPDATE TICKETS WITH RESOLVED STATUS
                    console.log('L');
                    for(var i = 0; i < resolvedTickets.length; i++) {
                        console.log('M');
                        db.tickets.update(
                            {ticket_id: resolvedTickets[i].ticket_id},
                            {
                                $set : {status: resolvedTickets[i].status},
                                $currentDate: { lastModified: true }
                            }
                        );
                    }

                    //--EMIT RESOLVED TICKETS STATUS
                    setTimeout(function() {
                        sendRecentTickets();
                    }, 2000);
                    break;
                }
            }
        });
    });
}

//START GAME SERVICE

//ATTEMPT FETCH LAST ROUND
fetchLastRound();

//CHECK IF FETCHED ROUND IS FINISHED
var numberOfTries = 0;
var triesLimit = 10;
var lastRoundDrawFetched = false;

var fetchLastRoundDrawInterval = setInterval(function() {
    if(lastRound.dbFetch) {
        fetchLastRoundDraw(false);
        clearInterval(fetchLastRoundDrawInterval);
        lastRoundDrawFetched = true;
    } else {
        if(numberOfTries == triesLimit) {
            clearInterval(fetchLastRoundDrawInterval);
            lastRoundDrawFetched = true;
            lastRound.finished = true;
        } else {
            numberOfTries++
        }
    }
}, 2000);

var drawingInterval = setInterval(function() {
    console.log('lastRoundDrawFetched: ' + lastRoundDrawFetched);

    if(lastRoundDrawFetched) {
        console.log('lastRound.finished: ' + lastRound.finished);
        if(!lastRound.finished) {
            //-- CONTINUE DRAW FOR THE UNFINISHED ROUND
            fetchLastRoundDraw(true);

            var numbersDrawInterval = setInterval(function() {
                if(dbRecord) {
                    clearInterval(numbersDrawInterval);
                    startNumbersDraw();
                }
            }, 1000);
        } else {
            //START ROUND
            startDrawingRound();
        }

        clearInterval(drawingInterval);
    }
}, 1000);

//RESOLVE TICKETS AFTER ROUND IS FINISHED AND START NEXT ROUND
