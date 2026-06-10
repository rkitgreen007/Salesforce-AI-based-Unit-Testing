import { execSync } from 'child_process';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const TARGET_ORG = process.env.SF_TARGET_ORG || 'default-scratch-org';

/**
 * Step 1: Query existing Products from the target Salesforce Scratch Org 
 * to ensure our reviews are contextually grounded to real records.
 */
function getActiveProducts() {
    console.log(`🔌 Fetching active products from target org: [${TARGET_ORG}]...`);
    try {
        // Uses the modern 'sf' CLI to pull down IDs and names in JSON format
        const sfCommand = `sf data query --query "SELECT Id, Name, ProductCode FROM Product2 WHERE IsActive = true LIMIT 5" --target-org ${TARGET_ORG} --json`;
        const resultBuffer = execSync(sfCommand);
        const resultJson = JSON.parse(resultBuffer.toString());
        
        if (resultJson.status === 0 && resultJson.result.records.length > 0) {
            return resultJson.result.records;
        } else {
            console.warn('⚠️ No active products found in the org. Using fallback mock products.');
            return [{ Id: '01t000000000000AAA', Name: 'Enterprise Cloud Server' }];
        }
    } catch (error) {
        console.error('❌ Failed to fetch products via sf CLI. Make sure your target org is active and authenticated.');
        process.exit(1);
    }
}

/**
 * Step 2: Use OpenAI Structured Outputs to generate high-fidelity, varied reviews.
 */
async function generateMockReviews(products) {
    console.log('🤖 Generating realistic, contextually relevant reviews via OpenAI...');
    
    // Create a context string out of actual products in the Salesforce Org
    const productContext = products.map(p => `ID: ${p.Id}, Name: ${p.Name}`).join('\n');

    const systemPrompt = `You are an AI engine specialized in seeding Salesforce CRM developer scratch orgs with high-fidelity testing data.
You will generate realistic product reviews based on the following real Product records currently in our database:
${productContext}

Requirements:
- Generate a mix of highly positive, neutral, and critical reviews.
- Out of the requested array, some reviews should contain corporate tech jargon, while others mimic disgruntled or highly satisfied consumer tones.
- Ensure the 'Review_Body__c' field summarizes a distinct, realistic operational use case or product failure.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // Cost-effective, high-speed model for structured data tasks
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Generate 5 contextually grounded product reviews matching our custom schema fields.' }
            ],
            // Enforce response format as a strict JSON object
            response_format: { type: "json_object" }
        });

        const rawJsonString = response.choices[0].message.content;
        
        // Save raw generation locally to act as a static asset blueprint if needed for standard test methods
        fs.writeFileSync('./generated-mock-data.json', rawJsonString, 'utf-8');
        console.log('💾 Successfully cached raw generation payload to generated-mock-data.json');
        
        return JSON.parse(rawJsonString).reviews;
    } catch (error) {
        console.error('❌ Error communicating with LLM engine:', error);
        process.exit(1);
    }
}

/**
 * Step 3: Stream the structured data payload back into Salesforce
 */
function seedDataToSalesforce(reviewRecords) {
    console.log(`🚀 Preparing data pipeline insertion for ${reviewRecords.length} records...`);
    
    // Format the payload into a standard Salesforce sObject Tree Save format
    const sfTreeStructure = {
        records: reviewRecords.map((review, index) => ({
            attributes: { type: 'Product_Review__c', referenceId: `refReview_${index}` },
            Product__c: review.Product__c,
            Rating__c: review.Rating__c,
            Reviewer_Email__c: review.Reviewer_Email__c,
            Title__c: review.Title__c,
            Review_Body__c: review.Review_Body__c
        }))
    };

    const tempFilePath = './tmp-sobject-tree.json';
    fs.writeFileSync(tempFilePath, JSON.stringify(sfTreeStructure, null, 2));

    try {
        console.log('⚡ Inserting records via sf data import tree...');
        const importCommand = `sf data import tree --files ${tempFilePath} --target-org ${TARGET_ORG}`;
        const output = execSync(importCommand).toString();
        console.log(output);
        console.log('✅ Scratch org seeding operation completed successfully!');
    } catch (error) {
        console.error('❌ SObject tree insertion failed:', error.stderr?.toString() || error.message);
    } finally {
        // Clean up temporary tree file
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

/**
 * Main Orchestration Loop
 */
async function main() {
    // 1. Target contextual binding data
    const targetProducts = getActiveProducts();
    
    // 2. Generate data matching your custom object schema
    const mockReviews = await generateMockReviews(targetProducts);
    
    // 3. Populate Scratch Org
    seedDataToSalesforce(mockReviews);
}

main();
