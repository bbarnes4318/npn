const fse = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');

// Configuration - adjust paths as needed
const AGENTS_DIR = process.env.AGENTS_DIR || path.join(__dirname, 'agents');
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || path.join(__dirname, 'submissions');

console.log('🔧 FIXING EXISTING SUBMISSIONS');
console.log('AGENTS_DIR:', AGENTS_DIR);
console.log('SUBMISSIONS_DIR:', SUBMISSIONS_DIR);

function newAgent({ firstName = '', lastName = '', email = '', phone = '' }) {
  return {
    id: nanoid(10),
    createdAt: new Date().toISOString(),
    profile: {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim()
    },
    progress: {},
    submissions: {},
    signatures: {},
    uploads: {}
  };
}

async function writeAgent(agent) {
  const agentDir = path.join(AGENTS_DIR, agent.id);
  await fse.ensureDir(agentDir);
  await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
  console.log(`✅ Created agent: ${agent.id} - ${agent.profile.firstName} ${agent.profile.lastName} (${agent.profile.email})`);
}

async function readAgent(agentId) {
  try {
    const agentPath = path.join(AGENTS_DIR, agentId, 'agent.json');
    if (await fse.pathExists(agentPath)) {
      return await fse.readJson(agentPath);
    }
  } catch (e) {
    console.error(`Error reading agent ${agentId}:`, e.message);
  }
  return null;
}

async function findOrCreateAgentByEmail(email) {
  const target = (email || '').toString().trim().toLowerCase();
  if (!target) return null;
  
  // 1) search existing agents
  try {
    const entries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(AGENTS_DIR, ent.name, 'agent.json');
      if (!(await fse.pathExists(p))) continue;
      try {
        const a = await fse.readJson(p);
        if ((a.profile?.email || '').toLowerCase() === target) return a;
      } catch {}
    }
  } catch {}
  
  return null;
}

async function fixExistingSubmissions() {
  console.log('\n📋 Processing existing submissions...');
  
  try {
    const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    console.log(`Found ${entries.length} submission directories`);
    
    let processedCount = 0;
    let createdAgents = 0;
    
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      
      try {
        const files = await fse.readdir(submissionDir);
        console.log(`\n📁 Processing submission: ${ent.name}`);
        console.log(`   Files: ${files.join(', ')}`);
        
        let submissionData = null;
        let submissionType = 'unknown';
        let email = '';
        let firstName = '';
        let lastName = '';
        let phone = '';
        
        // Process intake submission
        if (files.includes('intake.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
            submissionType = 'intake';
            email = submissionData.contact?.email || '';
            firstName = submissionData.contact?.firstName || '';
            lastName = submissionData.contact?.lastName || '';
            phone = submissionData.contact?.phone || '';
            console.log(`   📝 Intake submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading intake.json:`, e.message);
          }
        }
        
        // Process W9 submission
        else if (files.includes('w9.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
            submissionType = 'w9';
            email = submissionData.email || '';
            const name = submissionData.name || '';
            firstName = name.split(' ')[0] || '';
            lastName = name.split(' ').slice(1).join(' ') || '';
            phone = submissionData.phone || '';
            console.log(`   📄 W9 submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading w9.json:`, e.message);
          }
        }
        
        // Process banking submission
        else if (files.includes('banking.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
            submissionType = 'banking';
            email = submissionData.email || '';
            firstName = submissionData.firstName || '';
            lastName = submissionData.lastName || '';
            phone = submissionData.phone || '';
            console.log(`   🏦 Banking submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading banking.json:`, e.message);
          }
        }
        
        // Process packet submission
        else if (files.includes('packet.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
            submissionType = 'packet';
            // Packet submissions might not have direct contact info
            console.log(`   📦 Packet submission`);
          } catch (e) {
            console.error(`   ❌ Error reading packet.json:`, e.message);
          }
        }
        
        // Create agent if we have enough info
        if (email && (firstName || lastName)) {
          let agent = await findOrCreateAgentByEmail(email);
          
          if (!agent) {
            agent = newAgent({
              firstName,
              lastName,
              email,
              phone
            });
            await writeAgent(agent);
            createdAgents++;
          }
          
          // Link submission to agent
          if (submissionType === 'intake') {
            agent.progress.intakeSubmitted = true;
            agent.submissions.intakeId = ent.name;
          } else if (submissionType === 'w9') {
            agent.progress.w9Submitted = true;
            agent.submissions.w9Id = ent.name;
          } else if (submissionType === 'banking') {
            agent.progress.bankingSubmitted = true;
            agent.submissions.bankingId = ent.name;
          } else if (submissionType === 'packet') {
            agent.progress.packetSubmitted = true;
            agent.submissions.packetId = ent.name;
          }
          
          await fse.writeJson(path.join(AGENTS_DIR, agent.id, 'agent.json'), agent, { spaces: 2 });
          console.log(`   ✅ Linked ${submissionType} submission to agent ${agent.id}`);
        } else {
          console.log(`   ⚠️  Skipping - insufficient contact info (email: ${email}, name: ${firstName} ${lastName})`);
        }
        
        processedCount++;
        
      } catch (e) {
        console.error(`   ❌ Error processing submission ${ent.name}:`, e.message);
      }
    }
    
    console.log(`\n🎉 PROCESSING COMPLETE!`);
    console.log(`   📊 Processed: ${processedCount} submissions`);
    console.log(`   👥 Created: ${createdAgents} new agents`);
    console.log(`   🔗 All submissions now linked to agent records`);
    console.log(`\n✅ Your admin portal should now show ALL submitted forms!`);
    
  } catch (e) {
    console.error('❌ Error processing submissions:', e);
  }
}

// Run the fix
fixExistingSubmissions().then(() => {
  console.log('\n🏁 Script completed');
  process.exit(0);
}).catch(e => {
  console.error('💥 Script failed:', e);
  process.exit(1);
});
