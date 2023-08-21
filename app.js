const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch, getStream } = require('puppeteer-stream');
const fs = require('fs');

const app = express();
app.use(express.json());
let browserInstance = null;

puppeteer.use(StealthPlugin());

const recordings = {}; // Object to store ongoing recordings

function extractMeetingIdFromLink(link) {
    const parts = link.split('/');
    return parts[parts.length - 1];
}

async function startRecording(meetingLink, username) {
    try {
        const meetingId = extractMeetingIdFromLink(meetingLink);

        if (!browserInstance) {
            browserInstance = await launch(puppeteer, {
                //headless: false, // Show the browser window
                args: [
                    `--headless=new`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                ],
                plugins: [StealthPlugin()],
            });
        }

        const page = await browserInstance.newPage();
        await page.goto(meetingLink);
        await page.waitForSelector('[placeholder="Your name"]');
        await page.type('[placeholder="Your name"]', username);

        // Define a function to find a button by its text
        const findButtonByText = async (text) => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const buttonText = await button.evaluate(
                    (element) => element.textContent,
                );
                if (buttonText.includes(text)) {
                    return button;
                }
            }
            return null;
        };

        const askToJoinButton = await findButtonByText('Ask to join');
        if (askToJoinButton) {
            await askToJoinButton.click();
        } else {
            console.log('Button not found');
        }

        // Wait for the meeting to load (you can increase the delay if needed)
        await page.waitForTimeout(10000);

        // // Check if the meeting URL is still the same
        // const currentURL = page.url();

        const GotitButton = await findButtonByText('Got it');
        if (GotitButton) {
            await GotitButton.click();
        } else {
            console.log('Button not found');
        }

        await page.waitForTimeout(5000);

        const recordingStream = await getStream(page, { audio: true, video: true });
        console.log(`Recording started for meeting ID: ${meetingId}.`);

        const filePath = __dirname + `/meeting_recording_${meetingId}.webm`;
        const fileStream = fs.createWriteStream(filePath);
        recordingStream.pipe(fileStream);

        // Store recording information
        recordings[meetingId] = {
            page,
            recordingStream,
            fileStream,
        };

        fileStream.on('finish', () => {
            console.log(`Recording for meeting ID ${meetingId} finished.`);
            const recordingInfo = recordings[meetingId];
            recordingInfo.browser.close();
            delete recordings[meetingId];
        });

    } catch (error) {
        console.error(`An error occurred:`, error);
    }
}

app.post('/start-recording', async (req, res) => {
    const { meetingLink, username } = req.body;

    if (!meetingLink || !username) {
        return res.status(400).json({ error: 'Invalid data provided.' });
    }

    const meetingId = extractMeetingIdFromLink(meetingLink);

    if (recordings[meetingId]) {
        return res.status(400).json({ error: `Recording is already in progress for meeting ID ${meetingId}.` });
    }

    await startRecording(meetingLink, username);
    return res.status(200).json({ message: `Recording for meeting ID ${meetingId} started.` });
});

app.post('/stop-recording', async (req, res) => {
    const { meetingLink } = req.body;

    if (!meetingLink) {
        return res.status(400).json({ error: 'Invalid data provided.' });
    }

    const meetingId = extractMeetingIdFromLink(meetingLink);

    if (!recordings[meetingId]) {
        return res.status(400).json({ error: `No active recording for meeting ID ${meetingId}.` });
    }

    const recordingInfo = recordings[meetingId];

    const { page, recordingStream } = recordingInfo;

    try {
        recordingStream.destroy();

        await new Promise(resolve => {
            recordingStream.on('close', resolve);
        });

        await page.close(); // Close the tab

        console.log(`Recording stopped for meeting ID ${meetingId}.`);

        delete recordings[meetingId];

        if (Object.keys(recordings).length === 0) {
            await browserInstance.close(); // Close the browser if no ongoing recordings
            browserInstance = null;
        }

        return res.status(200).json({ message: `Recording for meeting ID ${meetingId} stopped.` });
    } catch (error) {
        console.error(`An error occurred while stopping recording for meeting ID ${meetingId}:`, error);
        return res.status(500).json({ error: 'An error occurred while stopping recording.' });
    }
});

const port = 5001;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
