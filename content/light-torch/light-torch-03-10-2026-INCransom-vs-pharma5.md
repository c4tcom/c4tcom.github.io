---
title: "Fast reaction to INC Ransom's Pharma5.ma Hit"
date: 2026-10-11
tags: ["Morocco", "Ransomware", "INC Ransom", "Pharma5.ma", "FortiBleed"]
summary: "DGSSI/maCERT moved quickly after INC Ransom listed Pharma5, a look at the bulletin, the group's TTPs, and the FortiBleed/Lynx connection."
---

It's genuinely cool to see DGSSI/maCERT react this fast, the same day Pharma5 (pharma5.ma) was publicly listed as a victim by INC Ransom (aka INC, INCransom) on September 25, they already had a bulletin out on the group.
My first thought was FortiBleed. If you remember that story, I went through that directory and a huge number of Moroccan companies were affected, and while the full picture was never entirely clear, it was attributed to a financially motivated threat actor. According to the folks over at SOCRadar, one operator was observed logged into both the INC Ransom and Lynx negotiation panels at once, which is about as direct a link as you get between a mass credential-theft campaign and actual ransomware deployment.

### The hit
INC Ransom listed the Casablanca-based pharmaceutical company³ on September 25, claiming ~50GB of exfiltrated data includes corporate and financial records, product and supply chain data, quality control and certification records, drug testing documentation, and employee personal data.


{{< figure src="/images/light-torch/2026-10-pharma5.jpeg" alt="Pharma5.ma listing on INC's ransomware blog" caption="Pharma5.ma listing on INC's ransomware blog" >}}


### Ruling out FortiBleed
I don't think this traces back to FortiBleed. **I went through the full FortiBleed directory**, and neither Pharma5 nor any Fortinet device tied to them shows up in it. Pharma5 does run a FortiGate. A quick Shodan check turns one up at ```102.50.244.4```, registered under Laboratoires Pharma5, but it isn’t one of the devices caught up in the FortiBleed campaign


{{< figure src="/images/light-torch/2026-Pharma5-Fortinet.jpeg" alt="" caption="Fortinet under pharma5, now taken offline." >}}



### INC Modus Operandi

So if not FortiBleed, what does INC's usual playbook look like? It's worth laying out before drawing conclusions on Pharma5. INC doesn't lean on a single signature exploit, and knowing their documented patterns makes it much easier to judge which explanation for this specific case holds up.
I'm not going to go through their full TTPs this time. In cases like this I'm mostly interested in the snake's head of initial access.

INC has exploited several vulnerabilities in the past : **Citrix (CitrixBleed, CVE-2023-3519)**, **Fortinet (CVE-2023-48788, CVE-2025-24472)** and **SimpleHelp (multiple privilege escalation CVEs)**. Besides these, which can grant initial access or at least lateral movement, phishing campaigns have also been observed and attributed to INC, which explains the samples shared below.

There's an old but good thread by the Microsoft Threat Intelligence team noting that Vice Society (tracked as Vanilla Tempest) was observed deploying INC. Vanilla Tempest in turn receives its initial access from Storm-0494, the actor behind the Gootloader malware.

{{< tweet user="MsftSecIntel" id="1836456406276342215" >}}

Multiple reports also point to RDP and RMM tool abuse. This threat profile by Huntress lists both as a recurring pattern across INC intrusions.
These are three separate observations, not one chain :

- Gootloader is one documented way INC-linked actors have gotten a foothold (via Vanilla Tempest / Vice Society).
- RDP and RMM abuse is a recurring pattern across INC intrusions generally, per Huntress.
- Infostealer-sourced credentials, often resold by initial access brokers (IABs), are a third, distinct path. They fit the same "valid account abuse" pattern without requiring either of the above.

None of these confirm what happened at Pharma5. They're just the set of plausible doors INC is known to walk through.
So which one, if any, actually applies here? That's where I went looking at what's exposed around Pharma5 itself, starting with infostealer intelligence.  The infections data surfaces the following URLs saved on infected employee devices :

```
https://rdp.pharma5.ma
https://rdp.pharma5.ma/rdweb/pages/fr-fr/login.aspx
https://rdp.pharma5.ma/RDWeb/Pages/fr-FR/login.aspx
https://vpn.pharma5.ma:4043/remote/login
https://vpn.pharma5.ma:4043/remote/logincheck
https://vpn.pharma5.ma:4043/proxy/[redacted]/https/10.x.xx.2x/hra-space/portal
https://vpn.pharma5.ma:4043/proxy/[redacted]/https/10.x.xx.2x/hra-space/portal
https://vpn.pharma5.ma:4043/proxy/[redacted]/https/10.x.xx.2x/hra-space/portal

```


The result is multiple employee infostealer infections tied to Pharma5's VPN and RDP services. It's not surprising to see RisePro telegram bot handle in the logs. , this last is commodity stealer sold on Telegram and widely pushed through pay-per-install loaders and cracked-software lures, and it shows code similarities with Vidar.
That covers the door, but not what came through it, the stealer logs only tell me who was exposed, not what ran afterwards. That's where the DGSSI bulletin comes in, alongside its description of the group, it shares a set of INC samples (hashes), and samples are the one thing I can use to look at the intrusion side instead of the exposure side.


### The Bulletin 
I ran every hash from the bulletin through VT and pulled the first submission date for each, to see how recent this activity really is and whether it lines up with the Pharma5 listing, very intresting findings, notably a recent upload of INCs ESXi crypter used to target VMware ESXi hypervisors.


{{< figure src="/images/light-torch/carbon-INC-macert-dgssi.png" alt="some of DGSSI's maCERT shared hashes" caption="some of DGSSI's maCERT shared hashes" >}}


A few other things that stands out :

Windows in July and August, Linux in September. Every Windows executable in the set first appears in July or August. All the Linux material (two ELFs and two ZIPs, including snapshot.zip) appears in September, in the three weeks before the Pharma5 listing. That includes the most recent upload, INC's ESXi crypter used to target VMware hypervisors. snapshot.zip contains yet another INC Linux ransomware build.

The index.html.NNN burst. Eight ZIP files named index.html.973 to `index.html.1008` were submitted on August 12. That naming is what `wget` produces when it keeps saving the same URL into a directory that already has the file, so something fetched the same URL a thousand times and got a different archive each time. I can't say what served them, but it looks like automated delivery rather than a single payload.

**`ransomware_notes-main.zip`.** The `-main.zip` suffix is what GitHub gives a downloaded repository archive, so this is probably a collection of ransom notes rather than a binary.

The caveat that applies to all of this: a first-submission date is only a floor for when a sample existed in the wild. It doesn't tell me when or where it was deployed, and none of these samples is tied to Pharma5. What it does show is that INC's Linux and ESXi tooling was being actively uploaded right up to the day the group listed a Moroccan pharma company.



#### What I take from this

Putting the pieces together:

- **FortiBleed doesn't explain Pharma5.** I checked the full dataset: neither Pharma5 nor its FortiGate is in it.
- **The exposure points at valid-account abuse.** Infostealer intelligence shows infected employee devices with saved sessions on Pharma5's VPN, RDP and webmail, and RisePro in the logs. That fits INC's documented patterns, but it's an opportunity, not proof of entry.


I can't tell you how INC actually got into Pharma5. What the evidence does suggest is that the weak point worth watching here isn't an l33t exploit, it's stolen creds on remote access.

If you have something to add on this case, or you're seeing the same patterns, reach me at `adnane [at] 0xdeadbeef.ma`.


**Note 10/10/2026** : Just saw that Qilin added the CNESTEN (Centre national de l'énergie des sciences et des techniques nucléaires) to their victim list, very interesting to keep an eye on, maybe bulletin this week?  