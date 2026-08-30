const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');

const FIRST_NAMES = [
  "Aarav", "Vihaan", "Aditya", "Sai", "Arjun", "Kabir", "Reyansh", "Krishna", "Ishaan", "Atharv",
  "Ananya", "Diya", "Priya", "Neha", "Aaradhya", "Saanvi", "Ishita", "Riya", "Kavya", "Sneha",
  "Amit", "Rahul", "Pooja", "Vikram", "Deepak", "Suresh", "Ramesh", "Kiran", "Geeta", "Sunita",
  "John", "Jane", "Robert", "Emily", "Michael", "Sarah", "David", "Jessica", "James", "Mary"
];

const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Patel", "Mehta", "Singh", "Kumar", "Joshi", "Rao", "Nair",
  "Reddy", "Choudhury", "Das", "Sen", "Mishra", "Trivedi", "Iyer", "Pillai", "Smith", "Johnson",
  "Williams", "Brown", "Jones", "Miller", "Davis", "Garcia", "Rodriguez", "Wilson", "Martinez", "Anderson"
];

const CALL_STATUSES = ["Completed", "Completed", "Completed", "Cancelled", "Missed"];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMobile() {
  let num = "";
  for (let i = 0; i < 10; i++) {
    num += getRandomNumber(0, 9);
  }
  return `+91 ${num.substring(0, 5)} ${num.substring(5)}`;
}

function generateDuration() {
  const mins = getRandomNumber(1, 20);
  const secs = getRandomNumber(0, 59);
  return `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
}

function generateTime() {
  const hour = getRandomNumber(1, 12);
  const min = getRandomNumber(0, 59);
  const ampm = getRandomElement(["AM", "PM"]);
  return `${hour < 10 ? '0' + hour : hour}:${min < 10 ? '0' + min : min} ${ampm}`;
}

const seedDatabase = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in .env");
    }

    console.log("[Seeder] Connecting to MongoDB Atlas...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[Seeder] Connection successful.");

    // Clean existing tables
    console.log("[Seeder] Cleaning existing database collections...");
    await User.deleteMany({ role: 'user' }); // keep admins if any
    await Call.deleteMany({});
    await Transaction.deleteMany({});
    console.log("[Seeder] Database cleaned.");

    console.log("[Seeder] Creating 100 dummy users...");
    const usersToInsert = [];
    const usedMobiles = new Set();

    // Ensure we have unique mobile numbers
    while (usersToInsert.length < 100) {
      const first = getRandomElement(FIRST_NAMES);
      const last = getRandomElement(LAST_NAMES);
      const name = `${first} ${last}`;
      const mobile = generateMobile();
      
      if (usedMobiles.has(mobile)) continue;
      usedMobiles.add(mobile);

      const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
      const credits = getRandomNumber(0, 80);
      const joinedDaysAgo = getRandomNumber(0, 60);
      const joined = new Date();
      joined.setDate(joined.getDate() - joinedDaysAgo);

      usersToInsert.push({
        name,
        mobile,
        password: "password123", // Will be auto-hashed by mongoose pre-save hook
        email,
        credits,
        role: 'user',
        isBlocked: Math.random() < 0.05, // 5% chance of being blocked
        joined
      });
    }

    // Insert Users sequentially or in batches (sequential triggers pre-save save hashing)
    // To speed up, we can use standard promise concurrency
    console.log("[Seeder] Hashing passwords and saving users... (this might take a few seconds)");
    const createdUsers = [];
    for (let i = 0; i < usersToInsert.length; i++) {
      const userDoc = new User(usersToInsert[i]);
      const savedUser = await userDoc.save();
      createdUsers.push(savedUser);
      if ((i + 1) % 20 === 0) {
        console.log(`[Seeder] Saved ${i + 1} users...`);
      }
    }
    console.log("[Seeder] All users saved successfully.");

    // Generate call logs and transaction logs for each user
    console.log("[Seeder] Generating random call logs and transactions...");
    const callsToInsert = [];
    const txnsToInsert = [];
    const usedCallIds = new Set();
    const usedTxnIds = new Set();

    for (const user of createdUsers) {
      const callCount = getRandomNumber(1, 10);
      const txnCount = getRandomNumber(1, 6);

      // Create dummy transactions
      for (let t = 0; t < txnCount; t++) {
        const txnDaysAgo = getRandomNumber(0, 45);
        const txnDate = new Date();
        txnDate.setDate(txnDate.getDate() - txnDaysAgo);

        // Ensure unique transaction ID
        let txnId;
        do {
          txnId = "TXN-" + getRandomNumber(1000, 9999) + getRandomNumber(10, 99);
        } while (usedTxnIds.has(txnId));
        usedTxnIds.add(txnId);

        const isCredit = Math.random() > 0.4; // 60% chance recharge, 40% call debit
        if (isCredit) {
          const creditsPacks = [10, 20, 50];
          const prices = { 10: "₹299", 20: "₹499", 50: "₹999" };
          const pack = getRandomElement(creditsPacks);
          
          txnsToInsert.push({
            txnId: txnId,
            user: user._id,
            date: txnDate,
            desc: `Credit Purchase (${pack} Credits)`,
            type: "credit",
            credits: pack,
            amount: prices[pack],
            status: "Successful"
          });
        } else {
          // Temporarily generate a temporary call ID for description, no need to be globally unique
          const tempCallId = "CALL-" + getRandomNumber(1000, 9999);
          
          txnsToInsert.push({
            txnId: txnId,
            user: user._id,
            date: txnDate,
            desc: `Call Charges (${tempCallId})`,
            type: "debit",
            credits: getRandomNumber(2, 15),
            amount: "₹0",
            status: "Completed"
          });
        }
      }

      // Create dummy call logs
      for (let c = 0; c < callCount; c++) {
        const callDaysAgo = getRandomNumber(0, 45);
        const callDate = new Date();
        callDate.setDate(callDate.getDate() - callDaysAgo);

        const status = getRandomElement(CALL_STATUSES);
        const duration = status === "Completed" ? generateDuration() : "00:00";
        const credits = status === "Completed" ? Math.ceil(parseInt(duration.split(":")[0])) : 0;

        // Ensure unique call ID
        let callId;
        do {
          callId = "CALL-" + getRandomNumber(1000, 9999);
        } while (usedCallIds.has(callId));
        usedCallIds.add(callId);

        callsToInsert.push({
          callId: callId,
          user: user._id,
          date: callDate,
          time: generateTime(),
          duration,
          credits,
          status
        });
      }
    }

    console.log(`[Seeder] Inserting ${callsToInsert.length} call logs...`);
    await Call.insertMany(callsToInsert);

    console.log(`[Seeder] Inserting ${txnsToInsert.length} transaction entries...`);
    await Transaction.insertMany(txnsToInsert);

    console.log("[Seeder] Database seeding finished successfully!");
    console.log(`- Created ${createdUsers.length} Users`);
    console.log(`- Created ${callsToInsert.length} Calls`);
    console.log(`- Created ${txnsToInsert.length} Transactions`);

    await mongoose.disconnect();
    console.log("[Seeder] Disconnected from MongoDB.");
  } catch (error) {
    console.error(`[Seeder Error] Seeding failed: ${error.message}`);
    process.exit(1);
  }
};

seedDatabase();
