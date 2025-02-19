var Chat = {
	socket: null,

	loading: document.getElementById("loading"),
	chat_box: document.getElementById("chat-box"),
	msgs_list: document.getElementById("msgs"),
	typing_list: document.getElementById("typing"),
	users: document.getElementById("users"),
	textarea: document.getElementById("form_input"),
	send_btn: document.getElementById("send"),

	is_focused: false,
	is_online: false,
	is_typing: false,
	last_sent_nick: null,

	original_title: document.title,
	new_title: "New messages...",

	scroll: function(){
		setTimeout(function(){
			Chat.chat_box.scrollTop = Chat.chat_box.scrollHeight;
		}, 0)
	},

	notif: {
		enabled: true,

		toggle: function(){
			return Chat.notif.enabled = !Chat.notif.enabled;
		},

		// Title time-out
		ttout: undefined,

		active: undefined,
		msgs: 0,

		// Beep notification
		beep: undefined,
		beep_create: function(){
			var audiotypes = {
				"mp3": "audio/mpeg",
				"mp4": "audio/mp4",
				"ogg": "audio/ogg",
				"wav": "audio/wav"
			};

			var audios = [
				'static/beep.ogg'
			];

			var audio_element = document.createElement('audio');
			if(audio_element.canPlayType){
				for(var i = 0;i < audios.length;i++){
					var source_element = document.createElement('source');
					source_element.setAttribute('src', audios[i]);
					if(audios[i].match(/\.(\w+)$/i)){
						source_element.setAttribute('type', audiotypes[RegExp.$1]);
					}
					audio_element.appendChild(source_element);
				}

				audio_element.load();
				audio_element.playclip = function(){
					audio_element.pause();
					audio_element.volume = 0.5;
					audio_element.currentTime = 0;
					audio_element.play();
				};

				return audio_element;
			}
		},

		// Create new notification
		create: function(from, message){
			// If is focused, no notification
			if(Chat.is_focused || !Chat.notif.enabled){
				return;
			}

			// Increase number in title
			Chat.notif.msgs++;

			// Create new ttout, if there is not any
			Chat.notif.favicon('blue');
			document.title = '(' + Chat.notif.msgs + ') ' + Chat.new_title;

			if(typeof Chat.notif.ttout === "undefined"){
				Chat.notif.ttout = setInterval(function(){
					if(document.title == Chat.original_title){
						Chat.notif.favicon('blue');
						document.title = '(' + Chat.notif.msgs + ') ' + Chat.new_title;
					} else {
						Chat.notif.favicon('green');
						document.title = Chat.original_title;
					}
				}, 1500);
			}

			// Do beep
			Chat.notif.beep.playclip();

			// If are'nt allowed notifications
			if(Notification.permission !== "granted"){
				Notification.requestPermission();
				return;
			}

			// Clear notification
			Chat.notif.clear();

			// Stip tags
			from = from.replace(/(<([^>]+)>)/ig, "");
			message = message.replace(/(<([^>]+)>)/ig, "");

			// Create new notification
			Chat.notif.active = new Notification(from, {
				icon: 'static/images/favicon-blue.png',
				//timeout: 10,
				body: message,
			});

			// On click, focus this window
			Chat.notif.active.onclick = function(){
				parent.focus();
				window.focus();
			};
		},

		// Clear notification
		clear: function(){
			typeof Chat.notif.active === "undefined" || Chat.notif.active.close();
		},

		favicon: function(color){
			var link = document.querySelector("link[rel*='icon']") || document.createElement('link');
			link.type = 'image/x-icon';
			link.rel = 'shortcut icon';
			link.href = 'static/images/favicon-' + color + '.ico';
			document.getElementsByTagName('head')[0].appendChild(link);
		}
	},

	send_msg: function(text){
		Chat.socket.send(
			JSON.stringify({ event: "send-msg", data: { m: text }})
		);
	},

	send_event: function(){
		var value = Chat.textarea.value.trim();
		if(value == "") return;

		console.log("Send message.");

		Chat.send_msg({text: value});

		Chat.textarea.value = '';
		Chat.typing.update();
		Chat.textarea.focus();
	},

	typing: {
		objects: {},

		create: function(nick){
			var li = document.createElement('li');

			var prefix = document.createElement('span');
			prefix.className = 'prefix';
			prefix.innerText = nick;
			li.appendChild(prefix);

			var msg = document.createElement('div');
			msg.className = 'message';

			var body = document.createElement('span');
			body.className = 'body writing'
			body.innerHTML = '<span class="one">&bull;</span><span class="two">&bull;</span><span class="three">&bull;</span>';
			msg.appendChild(body);

			li.appendChild(msg);

			Chat.typing_list.appendChild(li);

			Chat.typing.objects[nick] = li;

			// Scroll to new message
			Chat.scroll();
		},

		remove: function(nick){
			if(Chat.typing.objects.hasOwnProperty(nick)){
				var element = Chat.typing.objects[nick];
				element.parentNode.removeChild(element);
				delete Chat.typing.objects[nick];
			}
		},

		event: function(r){
			if(r.status){
				Chat.typing.create(r.nick);
			} else {
				Chat.typing.remove(r.nick);
			}
		},

		update: function(){
			if(Chat.is_typing && Chat.textarea.value === ""){
				Chat.socket.send(JSON.stringify({ event: "typing", data: Chat.is_typing = false}));
			}

			if(!Chat.is_typing && Chat.textarea.value !== ""){
				Chat.socket.send(JSON.stringify({event: 'typing', data: Chat.is_typing = true}));
			}
		}
	},

	new_msg: function(r){
		console.log("New message.");
		const fromSelf = sessionStorage.nick == r.f;

		// Notify user
		Chat.notif.create(r.f, r.m);

		var li = document.createElement('div');
		li.id = r.id;

		var prefix = document.createElement('span');
		prefix.className = 'prefix';
		prefix.innerText = r.f;
		li.appendChild(prefix);

		if(Chat.last_sent_nick === r.f){
			prefix.style.display = "none";
			li.prefix = prefix;
		} else {
			Chat.last_sent_nick = r.f;
		}

		var msg = document.createElement('div');
		msg.className = 'message';

		var body = document.createElement('span');
		body.className = 'body' + (fromSelf ? ' out' : ' in');
		Chat.append_msg(body, r.m);

		msg.appendChild(body);

		li.appendChild(msg);

		var c = document.createElement('li');
		c.appendChild(li);
		if (fromSelf){
			c.classList.add('message-from-self');
		}

		// Prepend because flex-direction: column-reverse
		Chat.msgs_list.prepend(c);

		// Scroll to new message
		Chat.scroll();
	},

	append_msg: function(el, msg){
		if(!msg) return;

		// If is object
		if(typeof msg.text !== 'undefined'){
			// Escape HTML
			el.innerText = msg.text;
			var text = el.innerHTML;

			// Parse urls
			text = text.replace(/(https?:\/\/[^\s]+)/g, function(url, a, b){
				var link = document.createElement('a');
				link.target = "_blank";

				// Un-escape
				link.innerHTML = url;
				url = link.innerText;
				link.href = url;

				// If link is image
				if(url.match(/.(png|jpe?g|gifv?)([?#].*)?$/g)){
					var img = document.createElement('img');
					img.style = 'max-width:100%;';
					img.src = url;

					link.innerText = "";
					link.appendChild(img);
				}

				return link.outerHTML;
			});

			if(typeof Emic !== 'undefined'){
				text = Emic.replace(text);
			}

			el.innerHTML = text;
		}

		if(typeof msg.type !== 'undefined'){
			// Image
			if(msg.type.match(/image.*/)){
				var img = document.createElement('img');
				img.style = 'max-width:100%;';
				img.src = msg.url;
				el.appendChild(img);
				return;
			}

			// Audio / Video
			if(m = msg.type.match(/(audio|video).*/)){
				var audio = document.createElement(m[1]);
				audio.controls = 'controls';

				var source = document.createElement("source");
				source.src = msg.url;
				source.type = msg.type;
				audio.appendChild(source);

				el.appendChild(audio);
				return;
			}

			// Default
			var link = document.createElement('a');
			link.href = msg.url;
			link.download = msg.name;
			link.innerText = msg.name;
			el.appendChild(link);
		}
	},

	force_login: function(fail){
		if(typeof fail !== "undefined"){
			alert(fail);
		}

		var nick = prompt("Your nick:", sessionStorage.nick || localStorage.nick || "");
		if(typeof nick !== "undefined" && nick){
			sessionStorage.nick = localStorage.nick = nick;
			ws.send(
				JSON.stringify( { event: "login", data: { nick: nick } } )
			);
		}
	},

	reload: function(){
		if(typeof sessionStorage.nick !== "undefined" && sessionStorage.nick){
			ws.send(
				JSON.stringify( { event: "login", data: { nick: sessionStorage.nick } } )
			);
		}
	},

	user: {
		objects: {},

		// Load all users
		start: function(r){
			Chat.users.innerText = '';

			for(var user in r.users){
				var nick = document.createElement('li');
				nick.innerText = r.users[user];
				Chat.users.appendChild(nick);
				Chat.user.objects[r.users[user]] = nick;
			}
		},

		previous_messages: function(data){
			console.log(`msgs:`, JSON.stringify(data))

			data.msgs.forEach(element => {
				Chat.new_msg(element)
			});
		},

		// User joined room
		enter: function(r){
			console.log("User " + r.nick + " joined.");

			var nick = document.createElement('li');
			nick.innerText = r.nick;
			Chat.users.appendChild(nick);
			Chat.user.objects[r.nick] = nick;
		},

		// User left room
		leave: function(r){
			console.log("User " + r.nick + " left.");

			// Is not typing
			Chat.typing.remove(r.nick);

			// Remove user
			if(Chat.user.objects.hasOwnProperty(r.nick)){
				var element = Chat.user.objects[r.nick];
				element.parentNode.removeChild(element);
				delete Chat.user.objects[r.nick];
			}
		}
	},

	connect: function(){
		// while websocket protocol does have ping/pong, some proxies may still close conn on us! Looking at you Cloudflare!
		setInterval(() => {
			if (Chat.socket.readyState === WebSocket.OPEN) {
				Chat.socket.send(JSON.stringify({ event: "ping" }));
				console.debug('Sending ping to server');
			}
		}, 30000);

		// Set green favicon
		Chat.notif.favicon('green');
		Chat.is_online = true;

		document.getElementById('offline').style.display = "none";
		Chat.msgs_list.innerText = '';
		Chat.typing_list.innerText = '';
		Chat.users.innerText = '';
		Chat.last_sent_nick = '';

		// force user to login
		Chat.force_login();
	},

	disconnect: function(){
		// Set green favicon
		Chat.notif.favicon('red');
		Chat.is_online = false;

		document.getElementById('offline').style.display = "block";
		Chat.msgs_list.innerText = '';
		Chat.typing_list.innerText = '';
		Chat.users.innerText = '';
	},

	init: function(socket){
		// Set green favicon
		Chat.notif.favicon('red');

		// Connect to websocket
		Chat.socket = socket;

		// Create beep object
		Chat.notif.beep = Chat.notif.beep_create();

		// On focus
		window.addEventListener('focus', function(){
			Chat.is_focused = true;

			// If chat is not online, dont care.
			if(!Chat.is_online){
				return;
			}

			// Clear ttout, if there was
			typeof Chat.notif.ttout === "undefined" || clearInterval(Chat.notif.ttout);
			Chat.notif.ttout = undefined;

			// Clear notifications
			Chat.notif.clear();
			Chat.notif.msgs = 0;
			Chat.notif.favicon('green');

			// Set back page title
			document.title = Chat.original_title;
		});

		// On blur
		window.addEventListener('blur', function(){
			Chat.is_focused = false;
		});

		// On click send message
		Chat.send_btn.onclick = Chat.send_event;

		// On enter send message
		Chat.textarea.onkeydown = function(e){
			var key = e.keyCode || window.event.keyCode;

			// If the user has pressed enter
			if(key === 13){
				Chat.send_event();
				return false;
			}

			return true;
		};

		// Check if is user typing
		Chat.textarea.onkeyup = Chat.typing.update;

		// On socket events
		Chat.socket.onopen = Chat.connect;
		Chat.socket.onclose = Chat.disconnect;

		Chat.socket.onmessage = function (e) {
			let message;
		
			try {
				message = JSON.parse(e.data);
			} catch (error) {
				console.error("Invalid JSON received:", e.data);
				return;
			}
		
			if (!message.event) {
				console.error("Missing event field in message:", message);
				return;
			}
		
			//console.debug("Received event:", message.event, "with data:", message);
		
			// dispatch events
			switch (message.event) {
				case "force-login":
					Chat.force_login(message.data);
					break;
				case "typing":
					Chat.typing.event(message.data);
					break;
				case "new-msg":
					Chat.new_msg(message.data);
					break;
				case "previous-msg":
					Chat.user.previous_messages(message);
					break;
				case "start":
					Chat.user.start(message.data);
					const event = new CustomEvent("chat-active");
					window.dispatchEvent(event);
					break;
				case "ue": // User entered
					Chat.user.enter(message.data);
					break;
				case "ul": // User left
					Chat.user.leave(message.data);
					const userLeft = new CustomEvent("ul");
					userLeft.data = message.data;
					window.dispatchEvent(userLeft);
					break;
				case "pong":
					console.debug('Received pong from server, all is well.', message);
					break;
				case "signaling-available":
					const signalEnabled = new CustomEvent("signaling-available");
					signalEnabled.data = message.data;
					window.dispatchEvent(signalEnabled);
					break;
				case "user-ready":
					const userReadyEvent = new CustomEvent("user-ready");
					userReadyEvent.id = message.data;
					window.dispatchEvent(userReadyEvent);
					break;
				case "signal":
					const signalEvent = new CustomEvent("signal");
					signalEvent.data = message.data;
					window.dispatchEvent(signalEvent);
					break;
				default:
					console.warn("Unknown event:", message.event);
			}
		};		

		var dropZone = document.getElementsByTagName("body")[0];

		// Optional. Show the copy icon when dragging over. Seems to only work for chrome.
		dropZone.addEventListener('dragover', function(e){
			e.stopPropagation();
			e.preventDefault();

			e.dataTransfer.dropEffect = 'copy';
		});

		// Get file data on drop
		dropZone.addEventListener('drop', function(e){
			e.stopPropagation();
			e.preventDefault();

			var files = e.dataTransfer.files; // Array of all files
			for(var i = 0;i < files.length;i++){
				var file = files[i];

				// Max 10 MB
				if(file.size > 10485760){
					alert("Max size of file is 10MB");
					return;
				}

				var reader = new FileReader();
				reader.onload = (function(file){
					return function(e){
						Chat.send_msg({
							type: file.type,
							name: file.name,
							url: e.target.result
						});
					};
				})(file);
				reader.readAsDataURL(file);
			}
		});

		// close socket upon refresh or tab close, free the username
		window.addEventListener("beforeunload", () => {
			if(!Chat.is_online){
				return;
			}
			Chat.socket.close();
		});
	}
};
