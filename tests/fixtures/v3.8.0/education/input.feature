Feature: Education domain rules

  Scenario: Student gradebook and enrollment
    Then the student's grade is "B+"
    And the GPA is "3.85"
    And the attendance rate is "95%"
    And the student is "present"
    And the assignment is "submitted"
    And the assignment due date is "2026-06-15"
    And the record is FERPA-protected
    And the student has 24 credits
    And the instructor is "Ms. Smith"
    And the term is "Fall 2026"
    And the student ID is "ST-12345"
    And the class size is 28
    And the quiz score is "85%"
    And the course is "available"
    And the school is "Lincoln High"
    And the parent is "John Doe"
    And the student's classification is "Senior"
