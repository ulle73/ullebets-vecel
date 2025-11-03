import puppeteer from "puppeteer";

async function main() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--no-first-run",
    ],
  });

  try {
    const page = await browser.newPage();
    console.log("Setting user agent...");
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
    );

    console.log("Navigating to Sofascore to initialize session...");
    await page.goto("https://www.sofascore.com/", {
      waitUntil: "domcontentloaded",
    });

    const url =
      "https://www.sofascore.com/api/v1/sport/football/scheduled-events/2025-11-03";
    console.log(`Fetching data from: ${url}`);

    const data = await page.evaluate(async (fetchUrl) => {
      const response = await fetch(fetchUrl);
      return response.json();
    }, url);

    console.log("Fetched data:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    console.log("Closing browser...");
    await browser.close();
  }
}

main();