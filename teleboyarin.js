var TelegramBot = require('node-telegram-bot-api'),
    request = require('request')
    rp = require('request-promise'),
    config = require('./config.json'),
    raven = require('raven'),
    repl = require('repl');

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

var bot = new TelegramBot(config.token, {
    polling: true
});

bot.on('text', onText);

function onText(msg) {
    var chatId = msg.chat.id, messageId = msg.message_id;
    var suffix = msg.text.split(' '), prefix = suffix.shift();
    console.log(msg);

    switch (prefix) {
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
                bot.sendMessage(chatId, reply, {reply_to_message_id: messageId, parse_mode: 'Markdown'});
            });
            break;
        case '/process':
            if (typeof suffix != "undefined" && suffix != null && suffix.length > 0) {
                var processURL = `${config.apiURL}/processes/${suffix}`,
                    workersURL = `${config.apiURL}/processes/${suffix}/workers`,
                    tasksURL   = `${config.apiURL}/processes/${suffix}/tasks`,
                    answersURL = `${config.apiURL}/processes/${suffix}/answers`;
                Promise.all([rp.get(processURL), rp.get(workersURL), rp.get(tasksURL), rp.get(answersURL)]).then(responses => {
                    var process = JSON.parse(responses[0]),
                        workers = JSON.parse(responses[1]).length,
                        tasks   = JSON.parse(responses[2]).length,
                        answers = JSON.parse(responses[3]).length;
                    var reply = `${process.description}\n*Workers:* ${workers}.\n*Tasks:* ${tasks}.\n*Answers:* ${answers}.`;
                    bot.sendMessage(chatId, reply, {reply_to_message_id: messageId, parse_mode: 'Markdown'});
                });
            } else {
                request.get(`${config.apiURL}/processes`, function(err, data, body) {
                    var processes = JSON.parse(body);
                    var reply = 'Which of the following: ' + processes.map(process => process.id).join(', ') + '?';
                    bot.sendMessage(chatId, reply, {reply_to_message_id: messageId, parse_mode: 'Markdown'});
                });
            }
            break;
        default:
            break;
    }
}
