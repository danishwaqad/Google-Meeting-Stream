const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch, getStream } = require('puppeteer-stream');
const fs = require('fs');

const app = express();
app.use(express.json());

puppeteer.use(StealthPlugin());

let browser = null;
let recordingStream = null;

async function autoRecordMeeting(meetingLink, username) {
    try {
        browser = await launch(puppeteer, {
            args: [
                `--headless=new`,  // Enable the new headless mode (Chrome v109)
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
            plugins: [StealthPlugin()],
        });

        const page = await browser.newPage();

        await page.goto(meetingLink);

        await page.waitForSelector('[placeholder="Your name"]');
        await page.type('[placeholder="Your name"]', username);
        await page.keyboard.press('Enter');

        await page.waitForTimeout(5000);

        recordingStream = await getStream(page, { audio: true, video: true });
        console.log('Recording Start');

        const filePath = __dirname + '/meeting_recording.webm';
        const fileStream = fs.createWriteStream(filePath);

        recordingStream.pipe(fileStream);

        fileStream.on('finish', () => {
            console.log('Recording finished.');
            browser.close();
            browser = null;
            recordingStream = null;
        });
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

app.post('/start-recording', async (req, res) => {
    const { meetingLink, username } = req.body;

    if (!meetingLink || !username) {
        return res.status(400).json({ error: 'Invalid data provided.' });
    }

    if (browser) {
        return res.status(400).json({ error: 'Recording is already in progress.' });
    }

    await autoRecordMeeting(meetingLink, username);
    return res.status(200).json({ message: 'Recording started.' });
});

app.post('/stop-recording', async (req, res) => {
    if (!browser) {
        return res.status(400).json({ error: 'No active recording to stop.' });
    }

    if (!recordingStream) {
        return res.status(400).json({ error: 'No recording stream available to stop.' });
    }

    // Wait for the recording stream to finish before closing the browser
    await new Promise(resolve => {
        recordingStream.on('close', resolve);
        recordingStream.destroy();
    });
    console.log('Recording stopped.');
    browser.close();
    browser = null;
    recordingStream = null;

    return res.status(200).json({ message: 'Recording stopped.' });

});

const port = 5001;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
