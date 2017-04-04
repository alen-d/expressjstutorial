var errorMessage;

$(document).ready(function() {
    errorMessage = document.getElementById('error_message');

    $('.deleteUser').on('click', deleteUser);

    $('#send_ticket').on('click', function(e) {
        //alert('SHIT');
        e.preventDefault();
        var params = getNumbers();
        console.log(params);

        if(!params) {
            //console.log('abort request');
            return;
        }

        clearValueByClassName('number');
        clearValueById('error_message');

        $.ajax({
            type: 'POST',
            url: '/ticket_add/' + params
        }).done(function(response) {
            //alert(response);
            //window.location.replace('/');
        });

    });
});

window.onload = function() {
    var roundResultFields = document.getElementsByClassName('round_result');
    var recentTicketsContainer = document.getElementById('recent_tickets_container');
    var recentTicketsTemplate = document.getElementById('recent_ticket_template');

    var socket = io.connect('localhost:3000');

    socket.on('message', function(data) {
        if(data.message) {
            console.log('connected to socket ' + data.message);
        } else {
            console.log('socket error: ' + data);
        }
    });

    socket.on('state', function(data) {
        if(data.state) {
            document.getElementById('round_no').innerHTML += data.state.round;

            for(var i = 0; i < data.state.drawn_numbers.length; i++) {
                document.getElementsByClassName('number-' + data.state.drawn_numbers[i].index)[0].innerHTML = data.state.drawn_numbers[i].value;
            }
        }
    });

    socket.on('round', function(data) {
        if(data.round) {
            clearValueByClassName('number_holder');
            document.getElementById('round_no').innerHTML = data.round;
        }
    });

    socket.on('round_results', function(data) {
        for(var i = 0; i < roundResultFields.length; i++) {
            try {
                if(data.results[i]['round'] && data.results[i]['numbers']) {
                    if(data.results[i]['numbers'].split(',').length == 35) {
                        roundResultFields[i].innerHTML = '<strong>' + data.results[i]['round'] + ':</strong> ' + data.results[i]['numbers'];
                    }
                }
            } catch(e) {
                //meh
            }
        }
    });

    socket.on('recent_tickets', function(data) {
        var recent_tickets = data.recent_tickets;
        console.log('!!!!!!!!!!!!!!!!!!!');
        console.log(recent_tickets);
        console.log('!!!!!!!!!!!!!!!!!!!');
        recentTicketsContainer.innerHTML = '';

        for(var i = 0; i < recent_tickets.length; i++) {
            //try {
            //console.log(typeof recent_tickets[i]['numbers']);
            var recentTicketRow = recentTicketsTemplate.cloneNode(true);
            //console.log(recentTicketRow.outerHTML);
            var recentTicketRowCells = recentTicketRow.getElementsByTagName('td');

            recentTicketRowCells[0].innerHTML = recent_tickets[i].ticket_id;
            recentTicketRowCells[1].innerHTML = recent_tickets[i].round;
            recentTicketRowCells[2].innerHTML = recent_tickets[i]['numbers'];
            recentTicketRowCells[3].innerHTML = recent_tickets[i].status;

            recentTicketRow.setAttribute('id', 'ticket-' + recent_tickets[i].ticket_id);
            recentTicketRow.className = '';

            recentTicketsContainer.appendChild(recentTicketRow);
        }
    });

    socket.on('number', function(data) {
        if(data.value) {
            document.getElementsByClassName('number-' + data.index)[0].innerHTML = data.value;
        } else {
            console.log('socket error: ' + data);
        }
    });
};

function getNumbers() {
    var numberFields = document.getElementsByClassName('number');
    var numbersArr = [];

    for(var i = 0; i < numberFields.length; i++) {
        if(!numberFields[i].value) {
            errorMessage.innerHTML = 'You must select all 6 numbers!';
            return false;
        }

        if(numbersArr.indexOf(numberFields[i].value) !== -1) {
            errorMessage.innerHTML = 'You must pick unique numbers!';
            return false;
        }

        if(numberFields[i].value < 1 || numberFields[i].value > 48) {
            errorMessage.innerHTML = 'You must pick numbers between 1 and 48!';
            return false;
        }

        numbersArr.push(numberFields[i].value);
    }

    return numbersArr.join(',');
}

function clearValueById(id) {
    var element = document.getElementById(id);
    element.innerHTML = '';
    element.value = '';
}

function clearValueByClassName(classname) {
    var fields = document.getElementsByClassName(classname);
    console.log(fields.length);

    for(var i = 0; i < fields.length; i++) {
        fields[i].innerHTML = '';
        fields[i].value = '';
    }
}

function deleteUser() {
    var confirmation = confirm('Are you sure?');

    if(confirmation) {
        $.ajax({
            type: 'DELETE',
            url: '/users/delete/' + $(this).data('id')
        }).done(function(response) {
            window.location.replace('/');
        });

        window.location.replace('/');
    } else {
        return false;
    }
}
