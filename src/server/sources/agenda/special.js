// Special Orders

import md5 from "md5";
import { minutesLink } from "../agenda.js";

export default async function (agenda, { quick = true } = {}) {
  let orders = agenda.split(/^ \d. Special Orders/ms).pop().split(/^ \d. Discussion Items/ms, 2)[0];

  let pattern = /\n+(?<indent>\s{3,5})(?<attach>[A-Z])\.\s(?<title>[^]*?)\n(?<text>[^]*?)(?=\n\s{4}[A-Z]\.\s|$)/sg;
  let people = [];

  let sections = [...orders.matchAll(pattern)].map(match => match.groups);

  sections.forEach(attrs => {
    let chairname, chair;
    attrs.attach = "7" + attrs.attach;
    let title = attrs.title.trim();
    let fulltitle = title;
    title = title
      .replace(/^Resolution to /m, "")
      .replace(/\sthe\s/, " ")
      .replace(/\sApache\s/, " ")
      .replace(/\sCommittee\s/, " ")
      .replace(/\sProject(\s|$)/i, "$1")
      .replace(/\sPMC(\s|$)/, "$1");

    if (/^Establish .* \((.*)\)$/m.test(title)) {
      title = title.replace(/\s.*?\(/, " ");
      title = title.replace(/\)$/m, "")
    } else {
      title = title.replace(/\s\(.*\)$/m, "")
    };

    if (title !== fulltitle) {
        attrs.fulltitle = fulltitle;
        attrs.title = title;
    }

    let text = attrs.text;
    attrs.digest = md5(text.trim());
    attrs.warnings = [];

    if (attrs.indent !== "    ") {
      attrs.warnings.push("Heading is not indented 4 spaces")
    };

    if (Math.min(...text.replace(/s+$/, "").match(/^ *\S/gm).map(item => item.length)) !== 8) {
      attrs.warnings.push("Resolution is not indented 7 spaces")
    };

    let title_checks = [
      [/^Establish/im, /^Establish the Apache .* (Project|Committee)$/m],
      [/^Change.*Chair/im, /^Change the Apache .* Project Chair$/m],
      [/^Terminate/im, /^Terminate the Apache .* Project$/m]
    ];

    for (let [select, match] of title_checks) {
      if (select.test(fulltitle) && !match.test(fulltitle) && /chair|project|committee/i.test(fulltitle + text)) {
        attrs.warnings.push(`Non-standard title wording: ${JSON.stringify(fulltitle)}; expected ${JSON.stringify(match)}`)
      }
    };

    delete attrs.indent;

    if (quick) {
      if (attrs.warnings.length === 0) delete attrs.warnings;
      return
    };

    let asfid = "[a-z][-.a-z0-9_]+";
    let list_item = "^[[:blank:]]*(?:[-*\\u2022]\\s*)?(.*?)[[:blank:]]+";

    people = Array.from(
      text.matchAll(new RegExp(`${list_item}\\((${asfid})\\)\\s*$`, "gm")),
      s => s.slice(1)
    );

    people += Array.from(
      text.matchAll(new RegExp(`${list_item}\\((${asfid})(?:@|\\s*at\\s*)(?:\\.\\.\\.|apache\\.org|apache\\sdot\\sorg)\\)\\s*$`, "gim")),
      s => s.slice(1)
    );

    people += Array.from(
      text.matchAll(new RegExp(`${list_item}<(${asfid})(?:@|\\s*at\\s*)(?:\\.\\.\\.|apache\\.org|apache\\sdot\\sorg)>\\s*$`, "gim")),
      s => s.slice(1)
    );

    let need_chair = false;
    let whimsy = "https://whimsy.apache.org";

    if (/Change (.*?) Chair/.test(title) || /Terminate (\w+)$/m.test(title)) {
      people = [];
      let committee = ASF.Committee.find(RegExp.$1);
      attrs.roster = `${whimsy}/roster/committee/${encodeURIComponent(committee.name)}`;
      attrs.stats = "https://reporter.apache.org/wizard/statistics?" + encodeURIComponent(committee.name);
      attrs.prior_reports = minutesLink(committee.display_name);

      let ids = Array.from(
        text.matchAll(/\((\w[-.\w]+)\)/g),
        s => s.slice(1)
      ).flat(Infinity);

      if (ids.length !== 0) {
        for (let id of ids) {
          let person = ASF.Person.find(id);
          if (person.icla) people.push([person.public_name, id])
        }
      };

      if (!committee.names) return;

      for (let [id, name] of committee.names) {
        if (text.includes(name) || title.includes("Term")) people.push([name, id])
      };

      if (people.length < 2 && !title.startsWith("Terminate")) {
        attrs.warnings.push("Unable to match expected number of names");
        attrs.names = committee.names
      };

      if (/Change (.*?) Chair/.test(title)) {
        need_chair = true
      } else if (committee.chair) {
        attrs.chair = committee.chair.id
      }
    } else if (/Establish (.*)/.test(title)) {
      let name = RegExp.$1;

      attrs.prior_reports = `${whimsy}/board/minutes/${name.replace(/\W/g, "_")}`;

      if (text.match(/[<(][-.\w]+@(?:[-\w]+\.)+\w+[>)]/g).some(email => (
        !email.includes("apache.org")
      ))) attrs.warnings.push("non apache.org email address found");

      if (/chair|project|committee/i.test(fulltitle)) need_chair = true;

      // extract the committee charter
      let charters = [];

      Array.from(
        text.matchAll(/\srelated to\s+(.+?)(?:;|\.?\n\n)/gm),
        s => s.slice(1),
        rto => charters << rto[0].replace(/\s+/g, " ")
      );

      if (charters.size !== 2) {
        attrs.warnings.push(`Expected 2 'related to' phrases; found ${charters.size}`)
      } else if (charters[0] !== charters[1]) {
        attrs.warnings.push(`'related to' phrases disagree: '${charters[0]}' != '${charters[1]}'`)
      };

      attrs.charter = charters[0]
    };

    if (need_chair) {
      if (/(BE IT|FURTHER) RESOLVED, that\s+([^,]*?),?\s+be\b/.test(text)) {
        chairname = RegExp.$2.replace(/\s+/g, " ").trim();

        if (/\s\(([-.\w]+)\)$/m.test(chairname)) {
          // if chair's id is present in parens, use that value
          if (RegExp.$1.length !== 0) attrs.chair = RegExp.$1;
          chairname = chairname.replace(/\s+\(.*\)$/m, "")
        } else {
          // match chair's name against people in the committee
          chair = people.find(person => person[0] === chairname);
          attrs.chair = (chair ? chair[chair.length - 1] : null)
        };

        if (!people.includes([chairname, attrs.chair])) {
          if (people.length === 0) {
            attrs.warnings.push("Unable to locate PMC email addresses")
          } else if (attrs.chair) {
            attrs.warnings.push("Chair not member of PMC")
          } else {
            attrs.warnings.push("Chair not found in resolution")
          }
        }
      } else {
        attrs.warnings.push("Chair not found in resolution")
      }
    } else if (/^Appoint /m.test(title)) {
      if (/FURTHER\s+RESOLVED, that\s+([^,]*?),?\s+be\b/i.test(text)) {
        chairname = RegExp.$1.replace(/\s+/g, " ").trim();
        chair = ASF.search_one(ASF.Person.base, `cn=${chairname}`);
        attrs.chairname = chairname;
        if (chair.length === 1) attrs.chair = chair[0].uid[0]
      };

      if (attrs.chair) {
        people = [[chairname, attrs.chair]]
      } else if (chairname) {
        attrs.warnings.push(`${JSON.stringify(chairname)} doesn't match public name`)
      } else {
        attrs.warnings.push("Officer name not found")
      }
    };

    people = Object.entries(people).map((name, id) => {
      let person = new ASF.Person(id);
      let icla = person.icla;

      return [id, {
        name,
        icla: (icla ? person.icla.name : false),
        member: person.asf_member
      }]
    });

    if (people.length !== 0) attrs.people = Object.fromEntries(people);
    if (attrs.warnings.length === 0) delete attrs.warnings
  });

  return sections;
}
