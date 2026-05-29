/**
 * v3.8.0 — Education domain rule pack (K-12, higher-ed, LMS).
 *
 * Opt-in via `ScaffoldOptions.domains: ["education"]`. Covers
 * gradebook, attendance, enrollment, LMS assignments, FERPA,
 * transcripts, instructor assignment, term/semester, student IDs,
 * class size.
 */

import type { PageObjectIR, StepBinding, StepIR } from "../../types";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

const SUBJ =
  "(?:I|user|User|the user|the User|the student|the teacher|the instructor)";

export const EDUCATION_RULES: Rule[] = [
  // EDU:01 — `the student's grade is "B+"` / `the grade in "Algebra" is "A"`
  {
    pattern:
      /^(?:the )?(?:student'?s? )?grade(?: in ["']([^"']+)["'])? is ["']?([A-F][+-]?)["']?$/i,
    build: (m, step) => {
      const subject = m[1];
      const letter = m[2].toUpperCase();
      if (subject) {
        return {
          step,
          customBody: [
            `const _row = page.locator("[data-testid='grade-row']").filter({ hasText: ${JSON.stringify(subject)} }).first();`,
            `await expect(_row).toContainText(${JSON.stringify(letter)});`,
          ].join("\n"),
        };
      }
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='grade'], [data-testid='current-grade']").first()).toContainText(${JSON.stringify(letter)});`,
      };
    },
  },

  // EDU:02 — `the GPA is "3.8"`
  {
    pattern: /^(?:the )?GPA is ["']?(\d\.\d{1,2})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _gpa = await page.locator("[data-testid='gpa']").first().innerText();`,
        `expect(Number(_gpa.replace(/[^\\d.]/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // EDU:03 — `the attendance rate is "95%"` / `the attendance is "N%"`
  {
    pattern:
      /^(?:the )?attendance(?: rate)? is ["']?(\d+(?:\.\d+)?%?)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='attendance-rate']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:04 — `the student is "present"` / `"absent"` / `"tardy"` / `"excused"`
  {
    pattern:
      /^(?:the )?student is ["']?(present|absent|tardy|excused|late)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='attendance-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:05 — `I enroll in course "Algebra II"` / `I enrol in "X"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?enroll?(?:s)? in (?:course |class )?["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `const _courseRow = page.locator("[data-testid='course-row']").filter({ hasText: ${JSON.stringify(m[1])} }).first();`,
        `await _courseRow.getByRole("button", { name: /enrol+/i }).click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // EDU:06 — `the assignment is "submitted"` / `"graded"` / `"late"` / `"missing"`
  {
    pattern:
      /^(?:the )?assignment is ["']?(submitted|graded|late|missing|in progress|pending)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='assignment-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:07 — `the assignment due date is "2026-06-15"`
  {
    pattern:
      /^(?:the )?(?:assignment )?due date is ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='due-date']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:08 — `the record is FERPA-protected` / `the data is FERPA-compliant`
  {
    pattern:
      /^(?:the )?(?:record|data|file) is (not )?FERPA[- ](?:protected|compliant)$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='ferpa-indicator'], [aria-label='FERPA protected']").first()).${matcher}();`,
      };
    },
  },

  // EDU:09 — `the transcript shows N credits` / `the student has N credits`
  {
    pattern:
      /^(?:the )?(?:transcript shows|student has) (\d+(?:\.\d+)?) credits?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _credits = await page.locator("[data-testid='credits-earned']").first().innerText();`,
        `expect(Number(_credits.replace(/[^\\d.]/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // EDU:10 — `the instructor is "Ms. Smith"` / `the teacher is "..."`
  {
    pattern:
      /^(?:the )?(?:instructor|teacher|professor) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='instructor-name'], [data-testid='teacher-name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:11 — `the term is "Fall 2026"` / `the semester is "Spring 2027"`
  {
    pattern:
      /^(?:the )?(?:term|semester|quarter) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='term'], [data-testid='semester']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:12 — `the student ID is "ST-12345"`
  {
    pattern: /^(?:the )?student ID is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='student-id']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:13 — `the class size is N` / `the class has N students`
  {
    pattern: /^(?:the )?class (?:size is|has) (\d+)(?: students?)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _classCount = await page.locator("[data-testid='enrolled-student']").count();`,
        `expect(_classCount).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // EDU:14 — `I submit the assignment` / `I submit assignment "X"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?submit(?:s)? (?:the )?assignment(?: ["']([^"']+)["'])?$`,
      "i",
    ),
    build: (m, step) => {
      const name = m[1];
      if (name) {
        return {
          step,
          customBody: [
            `const _row = page.locator("[data-testid='assignment-row']").filter({ hasText: ${JSON.stringify(name)} }).first();`,
            `await _row.getByRole("button", { name: /submit/i }).click();`,
          ].join("\n"),
        };
      }
      return {
        step,
        customBody: `await page.getByRole("button", { name: /submit.*assignment/i }).first().click();`,
      };
    },
  },

  // EDU:15 — `the quiz score is "85%"` / `"85/100"`
  {
    pattern:
      /^(?:the )?(?:quiz|test|exam) score is ["']?(\d+(?:\.\d+)?(?:%|\/\d+)?)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='quiz-score'], [data-testid='test-score']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:16 — `the course is "available"` / `"full"` / `"waitlisted"`
  {
    pattern:
      /^(?:the )?course is ["']?(available|full|closed|waitlisted|enroll(?:ed|ing))["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='course-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:17 — `the school is "Lincoln High"` / `the district is "..."`
  {
    pattern: /^(?:the )?(school|district|campus) is ["']([^"']+)["']$/i,
    build: (m, step) => {
      const kind = m[1].toLowerCase();
      return {
        step,
        customBody: `await expect(page.locator(\`[data-testid='${kind}-name']\`).first()).toContainText(${JSON.stringify(m[2])});`,
      };
    },
  },

  // EDU:18 — `the parent is "John Doe"` / `the guardian is "..."`
  {
    pattern:
      /^(?:the )?(?:parent|guardian|emergency contact) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='guardian-name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // EDU:19 — `I add a grade of "A" for "Quiz 1"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?(?:add|enter|record) (?:a )?grade of ["']?([A-F][+-]?)["']? for ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `const _gradeCell = page.locator("[data-testid='grade-cell']").filter({ hasText: ${JSON.stringify(m[2])} }).first();`,
        `await _gradeCell.fill(${JSON.stringify(m[1].toUpperCase())});`,
        `await page.getByRole("button", { name: /save/i }).click();`,
      ].join("\n"),
    }),
  },

  // EDU:20 — `the student's classification is "Freshman"` / `"Senior"` / `"Graduate"`
  {
    pattern:
      /^(?:the )?(?:student'?s? )?(?:classification|standing|grade level) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='classification'], [data-testid='standing']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },
];
