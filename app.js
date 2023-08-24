const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch, getStream } = require('puppeteer-stream');
const fs = require('fs');

const app = express();
app.use(express.json());
let browserInstance = null;
puppeteer.use(StealthPlugin());
const ongoingRecordings = {}; // Object to store ongoing recording information for each meeting ID

function extractMeetingIdFromLink(link) {
    const parts = link.split('/');
    return parts[parts.length - 1];
}

async function startRecording(meetingLink, username) {
    try {
        const meetingId = extractMeetingIdFromLink(meetingLink);

        if (ongoingRecordings[meetingId]) {
            console.log(`Recording is already in progress for meeting ID ${meetingId}.`);
            return;
        }

        if (!browserInstance) {
            browserInstance = await launch(puppeteer, {
                //headless: false,
                args: [
                    '--headless=new',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                ],
                defaultViewport: {
                    width: 1024,
                    height: 720,
                },
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

        await page.waitForTimeout(10000);

        try {
            // Wait for the element with class "uGOf1d" to appear
            await page.waitForSelector('.uGOf1d');

            // Find and extract the text content of the element with class "uGOf1d"
            const elementParticipant = await page.$eval('.uGOf1d', element => element.textContent);

            // Convert the element content to a number
            const elementValue = parseInt(elementParticipant, 10);
            if (elementValue > 0) {
                console.log(`Meeting joined successfully. ${meetingId}`); // Success message along with element content
                await page.waitForTimeout(5000);

                let gotItButton = await findButtonByText('Got it');
                if (gotItButton) {
                    await gotItButton.click();
                } else {
                    console.log('Button not found');
                }
            } else {
                console.log('Meeting participant element found, but value is not greater than 0.');
            }
        } catch (error) {
            console.error(`An error occurred:`, error);
        }

        const recordingStream = await getStream(page, { audio: true, video: true });
        console.log(`Recording started for meeting ID: ${meetingId}.`);

        const filePath = __dirname + `/meeting_recording_${meetingId}.webm`;
        const fileStream = fs.createWriteStream(filePath);
        recordingStream.pipe(fileStream);

        ongoingRecordings[meetingId] = {
            page,
            recordingStream,
            fileStream,
        };

        fileStream.on('finish', () => {
            console.log(`Recording for meeting ID ${meetingId} finished.`);
            const recordingInfo = ongoingRecordings[meetingId];
            recordingInfo.page.close();
            delete ongoingRecordings[meetingId];
        });

        await startValueCheckingInterval(meetingId, page);

        async function startValueCheckingInterval(meetingId, page) {
            const intervalId = setInterval(async () => {
                try {
                    const elementStop = await page.waitForSelector('.uGOf1d');
                    const elementParticipant = await elementStop.evaluate(element => element.textContent);
                    const elementValue = parseInt(elementParticipant, 10);
                    await checkElementValueAndStopRecording(elementValue, meetingId);
                } catch (error) {
                    console.error(`An error occurred while checking element value:`, error);
                }
            }, 10000);
            ongoingRecordings[meetingId].intervalId = intervalId; // Store the interval ID in the ongoingRecordings object
        }

        async function checkElementValueAndStopRecording(elementValue, meetingId) {
            if (elementValue === 1) {
                const response = await fetch('http://localhost:5001/stop-recording', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ meetingLink: meetingLink })
                });

                const data = await response.json();
                console.log(data.message);
            }
        }

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

    if (ongoingRecordings[meetingId]) {
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

    if (!ongoingRecordings[meetingId]) {
        return res.status(400).json({ error: `No active recording for meeting ID ${meetingId}.` });
    }

    const recordingInfo = ongoingRecordings[meetingId];

    const { page, recordingStream, intervalId } = recordingInfo;

    try {
        recordingStream.destroy();
        clearInterval(intervalId); // Cancel the interval associated with the meeting

        await new Promise(resolve => {
            recordingStream.on('close', resolve);
        });

        await page.close();

        delete ongoingRecordings[meetingId];

        if (Object.keys(ongoingRecordings).length === 0 && browserInstance) {
            await browserInstance.close();
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
