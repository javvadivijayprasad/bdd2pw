Feature: Government / civic domain rules

  Scenario: Benefits application and case management
    Then the form ID is "DS-11"
    And the applicant is "eligible"
    And the case number is "CASE-2026-001"
    And the case status is "open"
    And the monthly benefit is "$650"
    And the document type is "passport"
    And the FOIA request status is "pending"
    And the response is "redacted"
    And the residency status is "permanent resident"
    And the agency is "Department of Labor"
    And the program is "SNAP"
    And the intake date is "2026-01-15"
    And the application is "approved"
    And the page meets WCAG "AA"
    And the appeal is "filed"
    And the deadline is "2026-09-30"
    And the audit log records a "view-case" event
