/*******************************************************************************

    µMatrix - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

/******************************************************************************/

messaging.start('user-rules.js');

/******************************************************************************/

// Switches before, rules after

var directiveSort = function(a, b) {
    var aIsSwitch = a.indexOf(':') !== -1;
    var bIsSwitch = b.indexOf(':') !== -1;
    if ( aIsSwitch === bIsSwitch ) {
        return a.localeCompare(b);
    }
    return aIsSwitch ? -1 : 1;
};

/******************************************************************************/

var processUserRules = function(response) {
    var rules, rule, i;
    var permanentList = [];
    var temporaryList = [];
    var allRules = {};
    var permanentRules = {};
    var temporaryRules = {};
    var onLeft, onRight;

    rules = response.permanentRules.split(/\n+/);
    i = rules.length;
    while ( i-- ) {
        rule = rules[i].trim();
        permanentRules[rule] = allRules[rule] = true;
    }
    rules = response.temporaryRules.split(/\n+/);
    i = rules.length;
    while ( i-- ) {
        rule = rules[i].trim();
        temporaryRules[rule] = allRules[rule] = true;
    }
    rules = Object.keys(allRules).sort(directiveSort);
    for ( i = 0; i < rules.length; i++ ) {
        rule = rules[i];
        onLeft = permanentRules.hasOwnProperty(rule);
        onRight = temporaryRules.hasOwnProperty(rule);
        if ( onLeft && onRight ) {
            permanentList.push('<li>', rule);
            temporaryList.push('<li>', rule);
        } else if ( onLeft ) {
            permanentList.push('<li>', rule);
            temporaryList.push('<li class="notRight toRemove">', rule);
        } else {
            permanentList.push('<li>&nbsp;');
            temporaryList.push('<li class="notLeft">', rule);
        }
    }

    // TODO: build incrementally.

    uDom('#diff > .left > ul > li').remove();
    uDom('#diff > .left > ul').html(permanentList.join(''));
    uDom('#diff > .right > ul > li').remove();
    uDom('#diff > .right > ul').html(temporaryList.join(''));
    uDom('#diff').toggleClass('dirty', response.temporaryRules !== response.permanentRules);
};

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        var request = {
            'what': 'setUserRules',
            'temporaryRules': rulesFromHTML('#diff .right li') + '\n' + this.result
        };
        messaging.ask(request, processUserRules);
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
}

/******************************************************************************/

var startImportFilePicker = function() {
    var input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

function exportUserRulesToFile() {
    chrome.downloads.download({
        'url': 'data:text/plain,' + encodeURIComponent(rulesFromHTML('#diff .left li')),
        'filename': uDom('[data-i18n="userRulesDefaultFileName"]').text(),
        'saveAs': true
    });
}

/******************************************************************************/

var rulesFromHTML = function(selector) {
    var rules = [];
    var lis = uDom(selector);
    var li;
    for ( var i = 0; i < lis.length; i++ ) {
        li = lis.at(i);
        if ( li.hasClassName('toRemove') ) {
            rules.push('');
        } else {
            rules.push(li.text());
        }
    }
    return rules.join('\n');
};

/******************************************************************************/

var revertHandler = function() {
    var request = {
        'what': 'setUserRules',
        'temporaryRules': rulesFromHTML('#diff .left li')
    };
    messaging.ask(request, processUserRules);
};

/******************************************************************************/

var commitHandler = function() {
    var request = {
        'what': 'setUserRules',
        'permanentRules': rulesFromHTML('#diff .right li')
    };
    messaging.ask(request, processUserRules);
};

/******************************************************************************/

var editStartHandler = function(ev) {
    uDom('#diff .right textarea').val(rulesFromHTML('#diff .right li'));
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', true);
};

/******************************************************************************/

var editStopHandler = function(ev) {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
    var request = {
        'what': 'setUserRules',
        'temporaryRules': uDom('#diff .right textarea').val()
    };
    messaging.ask(request, processUserRules);
};

/******************************************************************************/

var editCancelHandler = function(ev) {
    var parent = uDom(this).ancestors('#diff');
    parent.toggleClass('edit', false);
};

/******************************************************************************/

var temporaryRulesToggler = function(ev) {
    var li = uDom(this);
    li.toggleClass('toRemove');
    var request = {
        'what': 'setUserRules',
        'temporaryRules': rulesFromHTML('#diff .right li')
    };
    messaging.ask(request, processUserRules);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importButton').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#exportButton').on('click', exportUserRulesToFile);

    uDom('#revertButton').on('click', revertHandler)
    uDom('#commitButton').on('click', commitHandler)
    uDom('#editEnterButton').on('click', editStartHandler)
    uDom('#editStopButton').on('click', editStopHandler)
    uDom('#editCancelButton').on('click', editCancelHandler)
    uDom('#diff > .right > ul').on('click', 'li', temporaryRulesToggler)

    messaging.ask({ what: 'getUserRules' }, processUserRules);
});

/******************************************************************************/

})();

