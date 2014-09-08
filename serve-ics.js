var request = require('request')
var http = require('http')
var cheerio = require('cheerio')
var url = require('url')
var scheduleURL = "http://css.csail.mit.edu/6.858/2014/schedule.html"

var cachedGCal = null;
var cachedO = null;
var requesting = false;
http.createServer(function(req, res) {
	if (requesting) {
		setTimeout(function() { reply(req, res); }, 500);
		return;
	}
	if (cachedGCal == null || cachedGCal.expires < Date.now()) {
		requesting = true;
		request(scheduleURL, function(err, resp, body) {
			if (err) {
				requesting = false;
				cachedGCal = { /* TODO */ };
			}
			cachedGCal = {
				expires: Date.now() + 30 /* minutes */ * 60 * 1000,
				events: extractEvents(body)
			};
			cachedO = "BEGIN:VCALENDAR\r\n";
			cachedO += "VERSION:2.0\r\n";
			cachedO += "PRODID:-" + scheduleURL + "\r\n";
			cachedO += "CLASS:PUBLIC\r\n";
			cachedO += "DESCRIPTION:6.858 calendar\r\n";
			cachedO += cachedGCal.events.map(toiCal).join("\r\n");
			cachedO += "\r\nEND:VCALENDAR";
			requesting = false;
			reply(req, res);
		});
	}
	reply(req, res);
}).listen(8080);

function reply(req, res) {
	if (requesting) {
		setTimeout(function() { reply(req, res); }, 500);
		return;
	}
	res.writeHead(200, {
		'Content-Type': 'text/calendar' /*TODO*/
	});
	res.write(cachedO);
	res.end();
}

function extractEvents(body) {
	var $ = cheerio.load(body);
	var es = $('.calendar td')
	var lectures = [];
	var assignments = [];
	var quizzes = [];
	es.each(function() {
		var e = $(this)
		if (!e.attr('id')) return;

		var dm = e.attr('id').match(/^(\d{4})-(\d+)-(\d+)/);
		if (!dm) return;

		var d = new Date(dm[1], dm[2]-1, dm[3])
		var event = {
			start: d,
			end: d,
			title: null,
			link: null,
			reading: [],
			stress: false,
			location: null,
			description: null
		}

		e.find('.reading a').each(function() {
			var e = $(this);
			if (e.text().match(/question/i) ||
			    e.text().match(/lab \d+:/i)) {
				assignments.push({
					'event': event,
					'stress': !!e.text().match(/question/i),
					'title': e.text().match(/question/i) ? 'question' : e.text() + ' released',
					'link': url.resolve(scheduleURL, e.attr('href'))
				});
			} else {
				event.reading.push({
					'title': e.text(),
					'link': url.resolve(scheduleURL, e.attr('href'))
				});
			}
		});

		if (e.text().match(/LEC \d+:/)) {
			var lt = e.text().replace(/[^]*^.*LEC \d+: (.+)$[^]*/gm, '$1');
			if (!lt.match(/guest lecture/i)) {
				event.title = 'Lecture: ' + lt
			} else {
				event.title = 'Guest lecture: ' + lt.replace(/guest lecture:\s*/i, '')
			}

			var a = e.children('b + a');
			if (a.length) {
				event.link = url.resolve(scheduleURL, a.attr("href"));
			}
		}

		if (e.text().match(/DUE:/)) {
			var lt = e.text().replace(/[^]*^.*DUE: (.+)$[^]*/gm, '$1');
			assignments.push({
				'event': event,
				'stress': true,
				'title': lt + ' due',
				'link': null
			});
		}

		if (e.text().match(/quiz \d+:/i)) {
			var desc = e.text().replace(/[^]*^.*(Quiz \d+: .+)$[^]*/gmi, '$1');
			var mat = e.text().replace(/[^]*^.*materials: (.+)$[^]*/gmi, '$1');
			var loc = e.text().replace(/[^]*^.*location: (.+)$[^]*/gmi, '$1');

			quizzes.push({
				'title': desc,
				'event': event,
				'materials': mat,
				'location': loc
			});
		}

		if (event.title) {
			lectures.push(event);
		}
	});

	events = lectures;

	assignments.forEach(function(e) {
		events.push({
			start: e.event.start,
			end: e.event.end,
			title: e.title,
			link: e.link,
			reading: [],
			stress: e.stress,
			location: null,
			description: null
		});
	});

	quizzes.forEach(function(e) {
		events.push({
			start: e.event.start,
			end: e.event.end,
			title: e.title,
			link: null,
			reading: [],
			stress: true,
			location: e.location,
			description: "Materials: " + e.materials
		});
	});

	return events;
}

function toiCal(event) {
	estr = [];
	estr.push("DTSTART;VALUE=DATE:"
		  + event.start.getFullYear() 
		  + ((event.start.getMonth()+1)+'').replace(/^(\d)$/, '0$1')
		  + (event.start.getDate()+'').replace(/^(\d)$/, '0$1')
		 );
	estr.push("DTEND;VALUE=DATE:"
		  + event.start.getFullYear() 
		  + ((event.start.getMonth()+1)+'').replace(/^(\d)$/, '0$1')
		  + (event.start.getDate()+'').replace(/^(\d)$/, '0$1')
		 );
	estr.push('SUMMARY:' + event.title);
	if (event.location) estr.push('LOCATION:' + event.location);
	if (event.link) estr.push('URL:' + event.link);
	if (event.reading.length) {
		event.description = event.description ? event.description + "\n" : "";
		event.description += "Read ";
		var rs = event.reading.map(function(e) { return e.title + ': ' + e.link; });
		var l = rs.pop();
		event.description += rs.join(", ") + ' and ' + l;
	}
	if (event.description) estr.push('DESCRIPTION:' + event.description);
	return "BEGIN:VEVENT\r\n" + estr.join("\r\n") + "\r\nEND:VEVENT"
}
