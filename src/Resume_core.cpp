//------------------------------------------------------------------------------------------------
// File:        Resume_core.cpp
// Contents:    Implementation of the RBC-1 resume logic module: canonical resume record,
//              CRC-32 integrity word, employment-duration computation, fixed-point easing,
//              navigation state resolution, and continuous built-in test (BIT).
// Standard:    Written in conformance with the Joint Strike Fighter Air Vehicle C++ Coding
//              Standards, Doc. No. 2RDU00001 Rev C, December 2005 ("JSF AV").
// Build:       Freestanding wasm32; no operating system, no C/C++ run-time library, no heap
//              [AV Rule 206], no exceptions [AV Rule 208], no recursion [AV Rule 119],
//              no floating point [AV Rule 202 by construction].
// Copyright:   (c) 2026 Robert Coe. All rights reserved.                          [AV Rule 133]
//
// DEVIATION RECORD                                                                [AV Rule 6]
// D-1 (AV Rule 163, "Unsigned arithmetic shall not be used"):
//      The CRC-32 subsystem operates on uint32 bit vectors. CRC-32 is polynomial division
//      over GF(2); its operations are exclusively bitwise (XOR, AND, logical right shift).
//      No unsigned addition, subtraction, multiplication, or division is performed anywhere
//      in this module. Unsigned types are required because the algorithm is defined on
//      32-bit unsigned bit patterns and because AV Rule 164.1 forbids right-shifting values
//      that could be negative. Scope of deviation: crc32_table_entry, crc32_of_bytes,
//      rb_data_crc_octet, and the s_crc_* / s_record_crc objects below. Approved: R. Coe,
//      module owner, 2026-06-09.
//      Note on approval authority: AV Rules 4-6 presume a program organization with a software
//      engineering lead and product manager recorded in a configuration-management tool. This
//      is a single-author module with no such structure; "module owner" names the only
//      authority that exists. See the Limitations section of STANDARD.md.
//------------------------------------------------------------------------------------------------

#include <Resume_core.h>                                                       // [AV Rule 33, 40]

namespace Rbc                                                                  // [AV Rule 98]
{
  // ---------------------------------------------------------------------------------------------
  // Module constants                                                          [AV Rule 151]
  // ---------------------------------------------------------------------------------------------

  const int32 months_per_year      = 12;        // calendar months in one year
  const int32 first_month          = 1;         // ordinal of January
  const int32 last_month           = 12;        // ordinal of December
  const int32 role_table_size      = 6;         // number of roles in the canonical record
  const int32 offset_table_size    = 16;        // fixed capacity of the section offset table
  const int32 activation_bias      = 160;       // px of look-ahead when resolving the active
                                                // section, so a heading activates as it nears
                                                // the top of the viewport rather than at it
  const int32 fraction_one         = 256;       // fixed-point unity (8 fractional bits)
  const int32 fraction_one_squared = 65536;     // fixed-point unity squared (16 bits)
  const int32 smooth_three         = 768;       // 3 in 8-bit fixed point, for smoothstep
  const int32 smooth_two           = 2;         // integer 2 of the smoothstep polynomial
  const int32 max_duration_ms      = 60000;     // longest permitted animation, in ms
  const int32 min_duration_ms      = 1;         // shortest permitted animation, in ms
  const int32 max_endpoint         = 1000000;   // endpoint magnitude bound; with 8 fractional
                                                // bits the worst intermediate product is
                                                // 2 000 000 * 256 = 512 000 000 < 2^31 - 1,
                                                // so no expression can overflow [AV Rule 203]
  const uint32 crc32_polynomial    = 0xEDB88320U;  // IEEE 802.3 polynomial, reflected form
  const uint32 crc32_initial       = 0xFFFFFFFFU;  // CRC-32 pre-conditioning value
  const uint32 crc32_check_value   = 0xCBF43926U;  // universal known-answer: the CRC-32 of
                                                   // the nine ASCII characters "123456789"
  const int32 crc_table_size       = 256;       // one table entry per possible byte value
  const int32 bits_per_byte        = 8;         // bit width of one octet
  const int32 byte_mask            = 0xFF;      // low-octet isolation mask
  const int32 crc_octet_count      = 4;         // octets in a 32-bit CRC value
  const int32 ease_test_duration   = 1000;      // BIT easing known-answer test duration, ms
  const int32 ease_test_target     = 1000;      // BIT easing known-answer test end value
  const int32 ease_test_midpoint   = 500;       // expected smoothstep value at half duration
  const int32 army_role_months     = 128;       // known answer: Jan 2005 - Aug 2015 inclusive
  const int32 record_revision_year = 2026;      // year of canonical record Rev B; the earliest
                                                // calendar year a correct host clock can report
  const int32 horizon_year         = 2099;      // latest load year this module accepts; a
                                                // later value indicates a corrupt host clock

  // Built-in test result codes. Enumeration is used rather than bare integers to select
  // from this limited series of conditions.                                   [AV Rule 148]
  enum Bit_condition
  {
    bit_nominal         = 0,     // all subsystems verified
    bit_fail_crc        = 1,     // CRC-32 subsystem failed its known-answer test
    bit_fail_ease       = 2,     // easing subsystem failed its known-answer test
    bit_fail_duration   = 4,     // duration subsystem failed its known-answer test
    bit_fail_bounds     = 8,     // defensive bounds handling failed verification
    bit_not_initialized = 16     // rb_init has not yet been called
  };

  // ---------------------------------------------------------------------------------------------
  // Canonical resume record
  // The integrity word displayed by the presentation layer is the CRC-32 of exactly these
  // bytes. Any tampering with the record changes the displayed word.
  // ---------------------------------------------------------------------------------------------

  // Identity and dated role intervals of record, as one contiguous byte sequence.
  static const char canonical_record[] =
    "RBC-1 CANONICAL RECORD REV B;"
    "NAME=ROBERT COE;"
    "TITLE=VETERAN LEADER - BUSINESS STRATEGIST - EDUCATOR;"
    "MAIL=ROBERT.BRUCE.COE AT GMAIL.COM;"
    "LINK=LINKEDIN.COM/IN/ROBERTTHEBRUCE;"
    "R0=EAGLE DYNAMICS,CLOSED BETA TESTER (ARTILLERY SME),2023-05,PRESENT;"
    "R1=UNIVERSITY OF WYOMING HOUSING,RESIDENT ASSISTANT,2023-12,2024-09;"
    "R2=WYOMING DOC,CORRECTIONAL OFFICER AND FTO,2017-07,2023-09;"
    "R3=WYOMING DWS,VETERANS SERVICE INTERN,2016-12,2017-07;"
    "R4=US ARMY,ROK-US MILITARY LIAISON,2015-09,2015-12;"
    "R5=US ARMY AND CO ARNG,BATTERY OPERATIONS CENTER CHIEF,2005-01,2015-08;";

  // One dated professional role. A structure is used because this entity carries no
  // invariant beyond its field ranges.                                        [AV Rule 65]
  struct Role_record
  {
    int32 start_year;    // four-digit year the role began
    int32 start_month;   // month the role began, 1 through 12
    int32 end_year;      // four-digit year the role ended; 0 denotes an open-ended role
    int32 end_month;     // month the role ended, 1 through 12; 0 denotes open-ended
    int32 is_military;   // 1 when the role is uniformed military service, else 0
  };

  // Dated intervals for each role, newest first, mirroring the canonical record above.
  static const Role_record role_table[role_table_size] =
  {
    { 2023,  5,    0,  0, 0 },   // R0: Eagle Dynamics, closed beta tester (artillery SME)
    { 2023, 12, 2024,  9, 0 },   // R1: University of Wyoming, resident assistant
    { 2017,  7, 2023,  9, 0 },   // R2: Wyoming DOC, correctional officer and FTO
    { 2016, 12, 2017,  7, 0 },   // R3: Wyoming DWS, veterans service intern
    { 2015,  9, 2015, 12, 1 },   // R4: U.S. Army, ROK-US military liaison
    { 2005,  1, 2015,  8, 1 }    // R5: U.S. Army and CO ARNG, battery operations center chief
  };                                                                           // [AV Rule 144]

  // ---------------------------------------------------------------------------------------------
  // Module state
  // All storage below is statically allocated at translation-unit scope with internal
  // linkage [AV Rule 137]; nothing is ever allocated from a heap [AV Rule 206]. The state
  // is encapsulated at the module boundary: it is reachable only through the exported
  // functions declared in Resume_core.h.                                      [AV Rule 207]
  // ---------------------------------------------------------------------------------------------

  static int32  s_bit_status       = bit_not_initialized;   // latest built-in test result
  static int32  s_current_year     = 0;                     // year supplied to rb_init
  static int32  s_current_month    = 0;                     // month supplied to rb_init
  static uint32 s_record_crc       = 0U;                    // CRC-32 of canonical_record
  static uint32 s_crc_table[crc_table_size] = { 0U };       // CRC-32 lookup table, built once
                                                            // during initialization
  static int32  s_section_offsets[offset_table_size] = { 0 };  // section thresholds, populated
                                                               // only by rb_section_push
  static int32  s_section_count    = 0;                     // count of valid section thresholds;
                                                            // invariant: 0 <= count <= capacity

  // ---------------------------------------------------------------------------------------------
  // Internal helper functions (file scope, internal linkage)                  [AV Rule 107, 137]
  // ---------------------------------------------------------------------------------------------

  // clamp_int32
  // Purpose:      Constrain a value to a closed interval; the defensive-programming primitive
  //               used throughout this module.                                [AV Rule 15]
  // Assumptions:  low <= high; all call sites below satisfy this by construction. [AV Rule 134]
  static int32 clamp_int32(int32 value, int32 low, int32 high)
  {
    int32 result = value;                  // single-exit working copy        [AV Rule 113]
    if (result < low)                      // below the interval?
    {
      result = low;                        // raise to the lower bound
    }
    else if (result > high)                // above the interval?
    {
      result = high;                       // lower to the upper bound
    }
    else
    {
      // Value already lies inside the interval; no adjustment is required.  [AV Rule 192]
    }
    return result;                         // sole exit point                 [AV Rule 113]
  }

  // crc32_table_entry
  // Purpose:      Compute one entry of the CRC-32 lookup table: the running remainder of
  //               byte_value under modulo-2 division by the IEEE 802.3 polynomial.
  //               Bitwise operations on uint32 only; see deviation D-1.
  static uint32 crc32_table_entry(int32 byte_value)
  {
    uint32 remainder = static_cast<uint32>(byte_value);   // byte as a 32-bit bit vector
    int32  bit_index = 0;                                 // bounded loop counter
    for (bit_index = 0; bit_index < bits_per_byte; ++bit_index)   // [AV Rule 198, 199]
    {
      if ((remainder & 1U) == 1U)          // low-order bit set: divide step applies
      {
        remainder = ((remainder >> 1) ^ crc32_polynomial);   // shift and subtract (XOR)
      }
      else
      {
        remainder = (remainder >> 1);      // shift only; polynomial does not divide
      }
    }
    return remainder;                      // sole exit point                 [AV Rule 113]
  }

  // build_crc_table
  // Purpose:      Populate the 256-entry CRC-32 lookup table. Runs once, during rb_init;
  //               this is initialization-time work, not post-initialization allocation.
  static void build_crc_table()
  {
    int32 byte_value = 0;                  // bounded loop counter
    for (byte_value = 0; byte_value < crc_table_size; ++byte_value)   // [AV Rule 198, 199]
    {
      s_crc_table[byte_value] = crc32_table_entry(byte_value);   // fill one table entry
    }
    return;                                // sole exit point                 [AV Rule 113]
  }

  // crc32_of_bytes
  // Purpose:      Compute the CRC-32 of a byte sequence using the prepared lookup table.
  //               Bitwise operations on uint32 only; see deviation D-1.
  // Assumptions:  The sequence contains only characters of the C++ basic source character
  //               set [AV Rule 9], whose values are non-negative in any signed char
  //               representation, so the char-to-uint32 conversion below loses no
  //               information.                                               [AV Rule 180, 134]
  static uint32 crc32_of_bytes(const char* bytes, int32 length)
  {
    uint32 crc        = crc32_initial;     // pre-conditioned running remainder
    int32  byte_index = 0;                 // bounded loop counter
    for (byte_index = 0; byte_index < length; ++byte_index)           // [AV Rule 198, 199]
    {
      uint32 octet = static_cast<uint32>(static_cast<uint8>(bytes[byte_index]));
                                           // widen through uint8 so no sign extension can
                                           // occur for any char representation [AV Rule 185]
      int32  slot  = static_cast<int32>((crc ^ octet) & static_cast<uint32>(byte_mask));
                                           // table slot for this byte; the masked value
                                           // is at most 255 so the narrowing conversion
                                           // is value-preserving               [AV Rule 180]
      crc = ((crc >> bits_per_byte) ^ s_crc_table[slot]);             // one division step
    }
    return (crc ^ crc32_initial);          // post-conditioning; sole exit    [AV Rule 113]
  }

  // months_inclusive
  // Purpose:      Whole months spanned by a closed year/month interval, counting both the
  //               first and last partial months as service months.
  static int32 months_inclusive(int32 start_year,
                                int32 start_month,
                                int32 end_year,
                                int32 end_month)                      // [AV Rule 58]
  {
    int32 year_span  = ((end_year - start_year) * months_per_year);   // whole-year months
    int32 month_span = ((end_month - start_month) + 1);               // inclusive remainder
    return (year_span + month_span);       // sole exit point                 [AV Rule 113]
  }

  // role_months_internal
  // Purpose:      Duration of one role with full defensive handling of out-of-range indices
  //               and open-ended intervals.                                  [AV Rule 15]
  static int32 role_months_internal(int32 role_index)
  {
    int32 result = 0;                      // out-of-range answer by default  [AV Rule 113]
    if ((role_index >= 0) && (role_index < role_table_size))          // [AV Rule 158]
    {
      int32 end_year  = role_table[role_index].end_year;    // 0 when role is open-ended
      int32 end_month = role_table[role_index].end_month;   // 0 when role is open-ended
      if (end_year == 0)                   // open-ended role: resolve against rb_init date
      {
        end_year  = s_current_year;        // close interval at the supplied year
        end_month = s_current_month;       // close interval at the supplied month
      }
      else
      {
        // Role already carries its recorded end date; nothing to resolve.   [AV Rule 192]
      }
      result = months_inclusive(role_table[role_index].start_year,
                                role_table[role_index].start_month,
                                end_year,
                                end_month);                           // [AV Rule 58]
    }
    else
    {
      // Index lies outside the role table; the defensive default of 0 stands. [AV Rule 192]
    }
    return result;                         // sole exit point                 [AV Rule 113]
  }

  // ease_internal
  // Purpose:      Integer smoothstep: s(t) = 3t^2 - 2t^3 evaluated in 8-bit fixed point.
  //               Overflow analysis (all signed 32-bit, worst cases):
  //                 normalized_time   <= 256
  //                 curve numerator   <= 256 * 256 * 768            = 50 331 648  < 2^31 - 1
  //                 span * eased      <= 2 000 000 * 256            = 512 000 000 < 2^31 - 1
  //               Therefore no expression below can overflow.                [AV Rule 203]
  static int32 ease_internal(int32 elapsed,
                             int32 duration,
                             int32 start_value,
                             int32 end_value)                         // [AV Rule 58]
  {
    int32 safe_duration   = clamp_int32(duration, min_duration_ms, max_duration_ms);
                                           // animation length, forced into legal range
    int32 safe_elapsed    = clamp_int32(elapsed, 0, safe_duration);   // time, clamped
    int32 safe_start      = clamp_int32(start_value, -max_endpoint, max_endpoint);
                                           // start endpoint, magnitude-bounded
    int32 safe_end        = clamp_int32(end_value, -max_endpoint, max_endpoint);
                                           // end endpoint, magnitude-bounded
    int32 normalized_time = ((safe_elapsed * fraction_one) / safe_duration);
                                           // t in [0, 256] fixed point
    int32 curve = ((normalized_time * normalized_time)
                   * (smooth_three - (smooth_two * normalized_time)));
                                           // 3t^2 - 2t^3, in 24 fractional bits [AV Rule 213]
    int32 eased = (curve / fraction_one_squared);   // reduce to 8 fractional bits; division
                                                    // is used instead of a right shift
                                                    // because the operand is signed
                                                    //                        [AV Rule 164.1]
    int32 span  = (safe_end - safe_start);          // total excursion of the animation
    return (safe_start + ((span * eased) / fraction_one));   // sole exit     [AV Rule 113]
  }

  // run_built_in_test
  // Purpose:      Verify every computational subsystem against known answers, mirroring the
  //               power-on BIT of an avionics line-replaceable unit.          [AV Rule 15]
  static int32 run_built_in_test()
  {
    int32 status = bit_nominal;            // accumulated failure bitmask     [AV Rule 113]

    // Subsystem 1: CRC-32 known-answer test against the universal check value.
    static const char check_input[] = "123456789";   // canonical CRC-32 test vector
    int32 check_length = (static_cast<int32>(sizeof(check_input)) - 1);   // exclude NUL
    if (crc32_of_bytes(check_input, check_length) != crc32_check_value)
    {
      status = (status | bit_fail_crc);    // record CRC subsystem failure
    }
    else
    {
      // CRC subsystem verified against IEEE 802.3 known answer.             [AV Rule 192]
    }

    // Subsystem 2: easing endpoints and midpoint known-answer tests.
    int32 ease_at_zero = ease_internal(0, ease_test_duration, 0, ease_test_target);
                                           // must equal the exact start value
    int32 ease_at_end  = ease_internal(ease_test_duration,
                                       ease_test_duration,
                                       0,
                                       ease_test_target);             // [AV Rule 58]
                                           // must equal the exact end value
    int32 ease_at_half = ease_internal((ease_test_duration / 2),
                                       ease_test_duration,
                                       0,
                                       ease_test_target);             // [AV Rule 58]
                                           // smoothstep is symmetric: must be the midpoint
    if ((ease_at_zero != 0)
        || (ease_at_end != ease_test_target)
        || (ease_at_half != ease_test_midpoint))                      // [AV Rule 158]
    {
      status = (status | bit_fail_ease);   // record easing subsystem failure
    }
    else
    {
      // Easing subsystem verified at start, midpoint, and end.              [AV Rule 192]
    }

    // Subsystem 3: duration computation known-answer test (Jan 2005 - Aug 2015 = 128 months).
    if (role_months_internal(role_table_size - 1) != army_role_months)
    {
      status = (status | bit_fail_duration);   // record duration subsystem failure
    }
    else
    {
      // Duration subsystem verified against recorded service dates.         [AV Rule 192]
    }

    // Subsystem 4: defensive bounds handling must reject out-of-range indices with 0.
    if ((role_months_internal(-1) != 0) || (role_months_internal(role_table_size) != 0))
    {
      status = (status | bit_fail_bounds);   // record bounds-handling failure
    }
    else
    {
      // Bounds handling verified on both sides of the legal range.          [AV Rule 192]
    }

    return status;                         // sole exit point                 [AV Rule 113]
  }

  // ---------------------------------------------------------------------------------------------
  // Exported interface (C linkage for stable WebAssembly export names)
  // Behavioral documentation for these functions resides in Resume_core.h.   [AV Rule 129]
  // ---------------------------------------------------------------------------------------------

  extern "C"
  {
    int32 rb_init(int32 current_year, int32 current_month)
    {
      s_current_year  = clamp_int32(current_year, record_revision_year, horizon_year);
                                           // load year forced into the era this record
                                           // can be valid for                 [AV Rule 15]
      s_current_month = clamp_int32(current_month, first_month, last_month);
                                           // month forced into the calendar  [AV Rule 15]
      build_crc_table();                   // initialization-time table construction
      s_record_crc = crc32_of_bytes(canonical_record,
                                    (static_cast<int32>(sizeof(canonical_record)) - 1));
                                           // integrity word over the canonical record,
                                           // excluding the terminating NUL
      s_bit_status = run_built_in_test();  // verify all subsystems before reporting ready
      return s_bit_status;                 // sole exit point                 [AV Rule 113]
    }

    int32 rb_bit_status()
    {
      return s_bit_status;                 // sole exit point                 [AV Rule 113]
    }

    int32 rb_data_crc_octet(int32 octet_index)
    {
      int32 result = 0;                      // out-of-range default            [AV Rule 113]
      if ((octet_index >= 0) && (octet_index < crc_octet_count))      // [AV Rule 158]
      {
        int32  shift = (octet_index * bits_per_byte);   // 0, 8, 16, or 24 bits
        uint32 octet = ((s_record_crc >> shift) & static_cast<uint32>(byte_mask));
                                             // isolate one octet of the CRC bit vector;
                                             // bitwise only, see deviation D-1. The masked
                                             // value is in [0, 255].
        result = static_cast<int32>(octet);  // [0, 255] is representable in int32 with
                                             // fully defined behavior          [AV Rule 8, 185]
      }
      else
      {
        // octet_index lies outside [0, 3]; the defensive default of 0 stands.  [AV Rule 192]
      }
      return result;                         // sole exit point                 [AV Rule 113]
    }

    int32 rb_role_count()
    {
      return role_table_size;              // sole exit point                 [AV Rule 113]
    }

    int32 rb_role_months(int32 role_index)
    {
      return role_months_internal(role_index);   // defensive logic lives in the helper
    }

    int32 rb_service_months()
    {
      int32 total      = 0;                // accumulated military months     [AV Rule 113]
      int32 role_index = 0;                // bounded loop counter
      for (role_index = 0; role_index < role_table_size; ++role_index)   // [AV Rule 198, 199]
      {
        if (role_table[role_index].is_military == 1)   // count military roles only
        {
          total = (total + role_months_internal(role_index));   // accumulate this role
        }
        else
        {
          // Civilian role: contributes nothing to uniformed service time.   [AV Rule 192]
        }
      }
      return total;                        // sole exit point                 [AV Rule 113]
    }

    int32 rb_ease(int32 elapsed,
                  int32 duration,
                  int32 start_value,
                  int32 end_value)                                    // [AV Rule 58]
    {
      return ease_internal(elapsed, duration, start_value, end_value);
    }

    int32 rb_section_reset()
    {
      s_section_count = 0;                  // discard any previously pushed thresholds
      return 0;                             // sole exit point                 [AV Rule 113]
    }

    int32 rb_section_push(int32 section_top)
    {
      int32 accepted = 0;                   // rejected unless there is room   [AV Rule 113]
      if (s_section_count < offset_table_size)   // capacity guard; count cannot exceed
      {                                          // the table size, so no overrun is possible
        s_section_offsets[s_section_count] = section_top;   // store at the next free slot
        s_section_count = (s_section_count + 1);            // advance the count
        accepted = 1;                       // report acceptance
      }
      else
      {
        // Table is at capacity; the push is ignored rather than overrunning.  [AV Rule 192]
      }
      return accepted;                       // sole exit point                 [AV Rule 113]
    }

    int32 rb_active_section(int32 scroll_position)
    {
      int32 result        = 0;             // default to the first section    [AV Rule 113]
      int32 threshold     = (scroll_position + activation_bias);   // biased scan position
      int32 section_index = 0;             // bounded loop counter
      for (section_index = 0; section_index < s_section_count; ++section_index)
      {                                                               // [AV Rule 198, 199]
        if (s_section_offsets[section_index] <= threshold)   // section top passed?
        {
          result = section_index;          // remember the deepest qualifying section
        }
        else
        {
          // This section begins below the scan position; earlier result stands.
          //                                                                  [AV Rule 192]
        }
      }
      return result;                       // sole exit point                 [AV Rule 113]
    }
  }
}
