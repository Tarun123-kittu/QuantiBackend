const OpenAI = require('openai');
const { PDFDocument } = require('pdf-lib');
const { fromPath } = require('pdf2pic');
const fs = require('fs')
const path = require('path');
require('dotenv').config();




const openai = new OpenAI({ apiKey: process.env.CHATGPT_KEY, });



//  CREATE OPENAI ASSISTANT 
async function createAssistant(fileId) {
  try {
    console.log("creating the new assisatant")
    const assistant = await openai.beta.assistants.create({
      name: "Quanti",
      description: "Assists with quantity surveying by analyzing drawings, calculating materials and costs in a casual tone.",
      instructions: "Quanti is designed to assist with quantity surveying. It reads and analyzes architectural drawings to calculate the volume and area of various elements. Once these calculations are made, it refers to an uploaded pricing spreadsheet to determine the cost of the project. Quanti provides accurate, clear, and detailed responses based on the data provided. It emphasizes precision and clarity in its calculations and avoids any assumptions without data. Quanti communicates in a casual tone, making it approachable and easy to understand for tradesmen. When a house plan is uploaded, Quanti the total quote based on rates from an uploaded spreadsheet",
      model: "gpt-4o",
      tools: [{ "type": "file_search" }],
    });
    return assistant;
  } catch (error) {
    console.log('Error::', error)
  }
}





// getting dimesions from image and provide a totalproject cost with that sending data to frontend in streams. 
async function analyseDimensionsFromImage(planImage, res) {
  try {
    console.log("in the image section----")
    const thread = await openai.beta.threads.create({
    messages: [
    {
    "role": "user",
    "content": [
    { "type": "text", "text": "If the file is not related to the dimensions then please give response like this 'file do not contains any dimensions.' otherwise use information from file search,Assists with quantity surveying by analyzing drawings, calculating materials and costs in a casual tone." },
    { "type": "image_url", "image_url": { "url": planImage } }
    ]}]
    });
    let accumulatedData = '';
    await new Promise((resolve, reject) => {
    
    const run = openai.beta.threads.runs.stream(thread.id, { assistant_id: process.env.OPENAI_ASSISTANT_ID })
    .on('textCreated', (text) => process.stdout.write('\nassistant > '))
    .on('textDelta', (textDelta) => {
    process.stdout.write(textDelta.value);
    res.write(textDelta.value)
    accumulatedData += textDelta.value;
    })
    .on('end', resolve)
    .on('error', reject);
    });
    let threadID = thread.id
    let response = { accumulatedData, threadID }
    return { response: response };
  } catch (error) { console.log("ERROR:: ", error) }
}





// converting pdf to image and then taking dimensions form the image to calculate the total project cost and sending data to frontend in streams
async function analyseDimensionsFromPdf(pdfFile ,res) {
  try {
    console.log('in the pdf section------')
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const pdfFilePath = path.join(outputDir, pdfFile.name);
    fs.writeFileSync(pdfFilePath, pdfFile.data);

    const existingPdfBytes = fs.readFileSync(pdfFilePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const totalPages = pdfDoc.getPageCount();
    console.log("Pages:", totalPages);
    // if(totalPages>9){return res.status(400).json({message:"Pdf file should not contain pages more than 9"})}

    const options = { density: 500, saveFilename: "page", savePath: outputDir, format: "png", width: 1200, height: 1200 };
    const convert = fromPath(pdfFilePath, options);

    const storeUploadedFileObj = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    try {
    const imagePath = await convert(pageNumber, { responseType: "image" });
    const response = await openai.files.create({
    file: fs.createReadStream(imagePath.path),
    purpose: "vision",
    });
    storeUploadedFileObj.push(response);
    console.log(`Uploaded image ${pageNumber}: page_${pageNumber}.png`);
    } catch (conversionError) {
    console.error('Error converting or uploading page:', conversionError);
    }}

    
    const thread = await openai.beta.threads.create({
    messages: [
    {
    "role": "user",
    "content": [
    { "type": "text", "text": "if the image is non-dimensional then respond 'this file is not related to this platfrom' otherwise use information from file search(Costing.pdf),Assists with quantity surveying by analyzing drawings, calculating materials and costs in a casual tone. Firstly give the information about the image and then calculate the cost accordingly." },
    ...storeUploadedFileObj.map(imgFile => ({ "type": "image_file", "image_file": { "file_id": imgFile.id } }))
    ]}]});

    let accumulatedData = '';
    await new Promise((resolve, reject) => {
    const run = openai.beta.threads.runs.stream(thread.id, { assistant_id: process.env.OPENAI_ASSISTANT_ID })
    .on('textCreated', (text) => process.stdout.write('\nassistant > '))
    .on('textDelta', (textDelta) => {
    process.stdout.write(textDelta.value);
    res.write(textDelta.value)
    accumulatedData += textDelta.value;
    })
    .on('end', async () => {
    await fs.rm(outputDir, { recursive: true, force: true }, (err) => {
    if (err) console.error('Error deleting output directory:', err);
    else console.log('Output directory deleted successfully.');
    });
    resolve();
    })
    .on('error', reject);
    });

    let threadID = thread.id
    let response = { accumulatedData, threadID }
    return { response: response };
  } catch (error) { console.log('ERROR:: ', error) }
}






//continue chat with the quantix
async function chatCompletion(res, threadID, prompt) {
  try {
    let accumulatedData = '';
    const message = await openai.beta.threads.messages.create(
      threadID,
      {
        role: "user",
        content: prompt
      }
    )
    await new Promise((resolve, reject) => {
      const run = openai.beta.threads.runs.stream(threadID, { assistant_id: process.env.OPENAI_ASSISTANT_ID })
        .on('textDelta', (textDelta) => {
          process.stdout.write(textDelta.value);
          res.write(textDelta.value);
          accumulatedData += textDelta.value;
        })
        .on('end', resolve)
        .on('error', reject);
    });

    return accumulatedData;
  } catch (error) {
    console.error("Error in chatWithOpenAi:", error);
    throw error;
  }
}



const getPageCount = async (pdfFile) => {
  const pdfDoc = await PDFDocument.load(pdfFile.data);
  return pdfDoc.getPageCount();
};


module.exports = {
  createAssistant,
  analyseDimensionsFromImage,
  analyseDimensionsFromPdf,
  chatCompletion,
  getPageCount
}
