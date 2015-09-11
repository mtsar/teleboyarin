var TelegramBot = require('node-telegram-bot-api'),
    request = require('request')
    rp = require('request-promise'),
    config = require('./config.json'),
    raven = require('raven'),
    repl = require('repl');

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

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

    console.log(msg);

    function stateInitial() {
        switch (text) {
            case '/start':
                bot.sendMessage(chatId, 'Hi, ' + msg.from.first_name + '!');
                break;
            case '/version':
                request.get(`${config.apiURL}/version`, function(err, data, body) {
                    var reply = `Mechanical Tsar v${body}`;
                    bot.sendMessage(chatId, reply, {reply_to_message_id: messageId});
                });
                break;
            case '/processes':
                request.get(`${config.apiURL}/processes`, function(err, data, body) {
                    var processes = JSON.parse(body);
                    var reply = processes.map(process => `*${process.id}*: ${process.description}`).join("\n");
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown'});
                });
                break;
            case '/process':
                request.get(`${config.apiURL}/processes`, function(err, data, body) {
                    var processes = JSON.parse(body);
                    var reply = 'Which one?';
                    var markup = JSON.stringify({
                        keyboard: processes.map(process => [process.id]),
                        force_reply: true,
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
                var processURL = `${config.apiURL}/processes/${text}`,
                    workersURL = `${config.apiURL}/processes/${text}/workers`,
                    tasksURL   = `${config.apiURL}/processes/${text}/tasks`,
                    answersURL = `${config.apiURL}/processes/${text}/answers`;
                Promise.all([rp.get(processURL), rp.get(workersURL), rp.get(tasksURL), rp.get(answersURL)]).then(responses => {
                    var process = JSON.parse(responses[0]),
                        workers = JSON.parse(responses[1]).length,
                        tasks   = JSON.parse(responses[2]).length,
                        answers = JSON.parse(responses[3]).length;
                    var reply = `[${process.description}](${processURL})\n*Workers:* ${workers}.\n*Tasks:* ${tasks}.\n*Answers:* ${answers}.`;
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown'});
                });
                break;
        }
        delete state[userId];
    }

    if (text == '/cancel' && state[userId].text) {
        var reply = `Cancelling the ${state[userId].text} operation.`;
        bot.sendMessage(chatId, reply);
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
