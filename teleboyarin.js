var TelegramBot = require('node-telegram-bot-api'),
    rp = require('request-promise'),
    config = require('./config.json'),
    raven = require('raven'),
    repl = require('repl');

if (process.env.SENTRY_DSN) new raven.Client(process.env.SENTRY_DSN).patchGlobal();

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

request = rp.defaults({headers: { 'Accept': 'application/json' }});

var state = {};

var bot = new TelegramBot(config.token, {
    polling: true
});

bot.on('text', onText);

function onText(msg) {
    var userId = msg.from.id, chatId = msg.chat.id, messageId = msg.message_id;
    var text = msg.text.trim();

    if (!!config.disabled) {
        bot.sendMessage(chatId, 'I am relaxing.');
        return;
    }

    function stateInitial() {
        switch (text) {
            case '/start':
                bot.sendMessage(chatId, 'Hi, ' + msg.from.first_name + '!');
                break;
            case '/version':
                request.get(`${config.apiURL}/version`).then(body => {
                    var reply = `Mechanical Tsar v${body}`;
                    bot.sendMessage(chatId, reply);
                });
                break;
            case '/processes':
                request.get(`${config.apiURL}/processes`).then(body => {
                    var processes = JSON.parse(body);
                    var reply = processes.map(process => `*${process.id}*: ${process.description}`).join("\n");
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown'});
                });
                break;
            case '/process':
                request.get(`${config.apiURL}/processes`).then(body => {
                    var processes = JSON.parse(body);
                    var reply = 'Which one?';
                    var markup = JSON.stringify({
                        keyboard: processes.map(process => [process.id]),
                        one_time_keyboard: true
                    });
                    bot.sendMessage(chatId, reply, {reply_markup: markup}).
                        then(() => state[userId] = {text: text, processes: processes});
                });
                break;
            default:
                break;
        }
    }

    function stateProcess() {
        switch (text) {
            default:
                var processReq = request.get(`${config.apiURL}/processes/${text}`),
                    workersReq = request.get(`${config.apiURL}/processes/${text}/workers`),
                    tasksReq   = request.get(`${config.apiURL}/processes/${text}/tasks`),
                    answersReq = request.get(`${config.apiURL}/processes/${text}/answers`);
                Promise.all([processReq, workersReq, tasksReq, answersReq]).then(responses => {
                    var process = JSON.parse(responses[0]),
                        workers = JSON.parse(responses[1]).length,
                        tasks   = JSON.parse(responses[2]).length,
                        answers = JSON.parse(responses[3]).length;
                    var reply = `[${process.description}](${processReq.uri.href})\n*Workers:* ${workers}.\n*Tasks:* ${tasks}.\n*Answers:* ${answers}.`;
                    var markup = JSON.stringify({hide_keyboard: true});
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown', reply_markup: markup});
                });
                break;
        }
        delete state[userId];
    }

    if (text == '/cancel') {
        var reply = !!state[userId] ? `Cancelling the ${state[userId].text} operation.` : 'Cancelling nothing.';
        var markup = JSON.stringify({hide_keyboard: true});
        bot.sendMessage(chatId, reply, {reply_markup: markup});
        delete state[userId];
    }

    switch (!!state[userId] ? state[userId].text : undefined) {
        case '/process':
            stateProcess();
            break;
        default:
            stateInitial();
            break;
    }
}
