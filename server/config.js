const Anthropic = require('@anthropic-ai/sdk');
const dotenv = require('dotenv');

dotenv.config();

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

module.exports = {
    anthropic,
};
