import { Client, GatewayIntentBits, Events, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { detect } from 'langdetect';
import fetch from 'node-fetch';
import { minecraftPrompts } from './src/config/prompts.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store server configurations
const serverConfigs = new Map();

// Context for the AI
const systemPrompt = `
You are a Minecraft server support bot that helps with server hosting panel issues.
Focus only on Minecraft server management and technical problems.
Respond in the same language as the user's query (Arabic or English).
Only discuss server technical issues and hosting-related topics.
Never recommend specific hosting providers.
Keep responses focused on solving technical problems.
When users ask about the panel URL, provide: ${process.env.PANEL_URL}
`;

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  (async () => {
    try {
      console.log('Started refreshing application (/) commands.');

      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: [
          {
            name: 'setup',
            description: 'Setup the bot for the server',
            defaultPermission: false,
          }
        ] },
      );

      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  })();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'setup') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply(
        interaction.locale === 'ar'
          ? 'عذراً، يجب أن تكون مسؤولاً للقيام بإعداد البوت.'
          : 'Sorry, you need to be an administrator to setup the bot.'
      );
    }

    serverConfigs.set(interaction.guild.id, {
      isConfigured: true,
      setupBy: interaction.user.id,
      setupDate: new Date().toISOString(),
      channelId: interaction.channel.id // Store the channel ID
    });

    const panelUrl = process.env.PANEL_URL;
    return interaction.reply(
      interaction.locale === 'ar'
        ? `تم إعداد البوت بنجاح! يمكنك الآن طرح أسئلة حول مشاكل خادم ماينكرافت.\nرابط لوحة التحكم: ${panelUrl}`
        : `Bot setup complete! You can now ask questions about Minecraft server issues.\nPanel URL: ${panelUrl}`
    );
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // Check if server is configured
  const serverConfig = serverConfigs.get(message.guild.id);
  if (!serverConfig?.isConfigured) {
    return message.reply(
      message.content.includes('عربي')
        ? 'يرجى إعداد البوت أولاً باستخدام الأمر /setup'
        : 'Please set up the bot first using /setup command'
    );
  }

  // Check if the message is in the configured channel
  if (message.channel.id !== serverConfig.channelId) {
    return message.reply(
      message.content.includes('عربي')
        ? 'يرجى استخدام القناة المحددة للبوت.'
        : 'Please use the designated bot channel.'
    );
  }

  // Handle panel command
  if (message.content.toLowerCase().startsWith('!panel')) {
    const panelUrl = process.env.PANEL_URL;
    return message.reply(
      message.content.includes('عربي')
        ? `رابط لوحة التحكم: ${panelUrl}`
        : `Panel URL: ${panelUrl}`
    );
  }

  // Check for inappropriate content
  const inappropriateWords = ['badword1', 'badword2']; // Add more inappropriate words here
  const containsInappropriateContent = inappropriateWords.some(word => message.content.toLowerCase().includes(word));

  if (containsInappropriateContent) {
    await message.delete();
    return message.channel.send(
      message.content.includes('عربي')
        ? 'تم حذف رسالتك لأنها تحتوي على محتوى غير لائق.'
        : 'Your message was deleted because it contains inappropriate content.'
    );
  }

  try {
    // Detect language
    const detectedLang = detect(message.content);
    const isArabic = detectedLang && detectedLang.some(lang => lang.lang === 'ar');

    // Read attached files
    let fileContent = '';
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.name.endsWith('.txt')) {
          const response = await fetch(attachment.url);
          fileContent += await response.text();
        }
      }
    }

    // Generate AI response
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Use a valid model name
    const prompt = `${systemPrompt}\n\nUser question: ${message.content}\n\nFile content: ${fileContent}`;
    
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Split response into chunks of 2000 characters
    const chunks = response.match(/[\s\S]{1,2000}/g) || [];

    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (error) {
    console.error('Error:', error);
    message.reply(
      message.content.includes('عربي')
        ? 'عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.'
        : 'Sorry, there was an error processing your request. Please try again.'
    );
  }
});

client.login(process.env.DISCORD_TOKEN);