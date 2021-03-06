async function newTeam() {

    var name = $('#name').val()
    var id = $('#id').val()
    var score = $('#score').val()

    // reset submission feedback
    $('#alert-box').empty()

    if (name == '' || id == '' || score == '' || !/^[A-Za-z0-9 \-_]+$/.test(id)) {
        console.log('Did not pass pre-validation.')
        return
    }

    if (parseInt(score) != NaN) {
        score = parseInt(score)
    } else {
        showAlert('Starting score must be an integer.')
        invalidate('#score')
        return
    }

    const response = await fetch('/teams/newteam', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'name': name,
            'id': id,
            'score': score
        })
    })

    if (response.status == 400) {
        var error = await response.text()
        showAlert(error);
        return;
    }

    if (response.status == 401) {
        showAlert('Unauthorized. Please log in.')
        return
    }

    if (response.status == 201) {
        showAlert('New team successfully added. <a href="/teams" class="alert-link">Click here</a> to go back to Teams.', 'success');
    } else if (response.status == 409) {
        invalidate('#id')
        $('#idFeedback').text('Team already exists.')
    }
    else {
        showAlert(data.reason);
    }
}

async function removeTeam(id, confirm) {

    console.log("ID: ", id);

    var confirmed;

    if (confirm) {
        confirmed = window.confirm('Are you sure? This cannot be undone.')
    } else {
        confirmed = true;
    }

    if (!confirmed) {
        return;
    }

    const response = await fetch('/teams/removeteam', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'id': id
        })
    });

    console.dir(response);

    if (response.status == 401) {
        showAlert('Unauthorized. Please log in.');
        return;
    }

    const data = await response.text()

    if (response.status == 200) {
        showAlert('Removed team.', 'success');
    } else {
        showAlert(data);
    }
}

async function editTeam() {
    var name = $('#name').val()
    var id = $('#id').val()
    var oldId = $('#oldId').val()

    // reset submission feedback
    $('#alert-box').empty()

    if (name == '' || id == '' || !/[0-9]{3}/.test(id)) {
        return
    }

    const response = await fetch('/teams/editteam', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: name,
            id: id,
            oldId: oldId
        })
    });

    switch (response.status) {
        case 400: // Bad Request
            var message = await response.text()
            showAlert('Invalid parameters: ' + message)
            return;
    }

    const data = await response.text();

    if (response.status == 200) {
        showAlert('Team data changed. <a href="/teams" class="alert-link">Click here</a> to go back to Teams.', 'success');
        $('#oldId').val(id);
    } else if (response.status == 304) {
        showAlert('No data was changed. <a href="/teams" class="alert-link">Click here</a> to go back to Teams.', 'success')
    } else if (response.status == 409) {
        $('#id').addClass('is-invalid');
        $('#idFeedback').text('Team with that ID already exists')
    } else {
        showAlert(data.reason);
    }

}

async function changeScore() {

    var id = $('#team').val()
    var score = $('#score').val()

    const response = await fetch('/teams/changescore', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: id,
            score: score
        })
    })

    const data = await response.text();

    if (response.status == 200) {
        showAlert('Score updated. <a href="/teams" class="alert-link">Click here</a> to go back to Teams.', 'success');
    } else if (response.status == 304) {
        showAlert('No data was changed. <a href="/teams" class="alert-link">Click here</a> to go back to Teams.', 'success')
    } else {
        showAlert(data);
    }
}