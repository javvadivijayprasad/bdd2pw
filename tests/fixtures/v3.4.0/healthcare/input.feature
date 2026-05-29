Feature: Healthcare domain rules

  Scenario: Patient encounter
    Then the patient's name is "John Doe"
    And the patient ID is "MRN12345"
    And the appointment is scheduled for "2026-06-01"
    And the diagnosis code is "ICD-10:E11.9"
    And the medication "Metformin" is prescribed
    And the patient has signed consent form "HIPAA-1"
    And the HL7 message type is "ADT^A01"
    And the FHIR resource is "Patient/123"
    And the patient's data is encrypted
    And the blood pressure reading is "120/80"
    And the heart rate is 72 bpm
    And the patient is allergic to "penicillin"
    And the provider NPI is "1234567890"
    And the provider DEA number is "AB1234567"
    And the lab result for "HbA1c" is "5.8"
