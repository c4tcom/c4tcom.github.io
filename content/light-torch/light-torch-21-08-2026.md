---
title: "Morocco's $2 Million Reason to Patch Your VPN."
date: 2025-07-22
tags: ["Morocco", "Ransomware", "Lockbit", "Qilin"]
summary: "A breakdown of the ransomware groups actively targeting Moroccan companies in 2026 : LockBit, Medusa, Qilin, and how they're getting in."
---

On the 20th of August, [assabah.ma](https://assabah.ma) published an [article](https://assabah.ma/938227.html?1&1) about a Moroccan "economic group" being extorted by a ransomware group, what stands out is that this kind of story rarely surfaces in mainstream Moroccan media most of these incidents and specially ransomware gets a quiet attention among practitioners, if at all. The article's focus is less on the technical side and more on the fact that the victim brought in a foreign negotiation firm to deal with the threat actors directly.

The contact was reportedly initiated via a "dark web message" informing the victim that data had already been taken, with samples provided as proof. The demand was **$2 million USD** payable in cryptocurrency within a two-month window, with negotiations still ongoing to bring that figure down. 


#### StealBIT/ Software/S1200

One technical detail worth pulling out, that the attackers reportedly used **StealBit** for exfiltration, "**StealBit**" isn't some generic tool it's LockBit's own purpose-built exfiltration utility, released alongside LockBit 2.0 & 3.0 specifically so affiliates wouldn't have to rely on third-party file-sharing services that can be taken down, seeing it show up here suggests this incident sits somewhere in the LockBit lineage and either a current affiliate, or one of the many groups that have repurposed LockBit's builder since it leaked in 2022. That's a meaningful clue even without an on-record group attribution.


{{< figure src="/images/light-torch/stealbit-lockbit.png" alt="Stealbit comparative table by lockbit" caption="Stealbit comparative table by Lockbit" >}}


#### What actually should be watched for 

Pulling the full Moroccan victims as of writing this blog, going back to 2021 most of it is noise, one&off opportunistic claims from smaller or short-lived operators, but a handful of groups on that list are the ones worth actually tracking, because of how established, prolific, or capable they are globally, not just locally:

- **LockBit (2.0/3.0/5.0) :** The group behind StealBit itself, and the most persistent name on the Moroccan list by far: ceratube.ma (2021), galenica.ma (famous one) + others and most recently Planet Sport under LockBit 5.0 (April 2026) and potentially more victims that went unnoticed or kept their secracy (like our big economic group) despite [Operation Cronos](https://www.europol.europa.eu/media-press/newsroom/news/law-enforcement-disrupt-worlds-biggest-ransomware-operation) takedown in 2024, the brand and the leaked builder are clearly still circulating and still landing Moroccan victims years later.


- **Medusa :** Hit Steripharma (pharma) in 2023 and La Voie Express (logistics) in 2025 and 2 more Moroccan victims that maybe payed the ransom or somehow managed to not appear in their DLS, Medusa is known for their aggressive double-extortion and a public leak-site countdown model, and has been one of the more active RaaS operations globally over the past two years.

- **Qilin :** Claimed Outsourcia (business services/BPO) in March 2026 and Eurodefis on the 10/07/2026, this group has grown into one of the most active ransomware-as-a-service operations worldwide recently, largely by absorbing affiliates displaced from other takedowns, there's a very nice article recently shared by Arctic Wolf on [How Exploitation of CVE-2026-0257 Leads to Qilin Ransomware](https://arcticwolf.com/resources/blog/exploitation-of-cve-2026-0257-leads-to-qilin-ransomware/), worth to mention that 7 days later on friday the 17th maCERT shared a [security bulletin on Qilin](https://www.dgssi.gov.ma/fr/bulletins/groupe-cybercriminel-qilin/) 


{{< figure src="/images/light-torch/Qilin-submissions-vt-07-2026.svg" alt="Qilin hashes shared by the DGSSI/maCERT after the recent Moroccan victim" caption="Last 3 months Qilin hashes shared by the DGSSI/maCERT - VT submission date after the recent Moroccan victim" >}}


- **RansomHub :** Claimed askgs.ma in February 2025, same as Qilin, RansomHub scaled up fast by picking up affiliates from ALPHV/BlackCat  after that group's exit scam, and briefly became one of the highest-volume RaaS brands globally, the ASKGS made it to the headlines aswell when Ransomhub asked for 500k USD as ransom. 

{{< x user="hespress" id="1883998421863809228" >}}




Putting the pattern together a major RaaS lineage (LockBit) still landing hits years after its "takedown," two of the fastest-growing RaaS brands of the moment (Qilin, RansomHub) already present, and unexplained clusters from newer names, my honest read is that **Morocco is becoming a more attractive target** than it used to be, not just an occasional opportunistic hit, whether that's driven by weak perimeter hygiene, the growing digitization of mid-sized Moroccan businesses, or affiliates simply running wider scans post-CVE, is something I want to keep watching rather than assume.

