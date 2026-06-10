//------------------------------------------------------------------------------------------------
// File:        Resume_core.h
// Contents:    External interface of the RBC-1 resume logic module.
// Standard:    Written to the discipline of the Joint Strike Fighter Air Vehicle C++ Coding
//              Standards, Doc. No. 2RDU00001 Rev C, December 2005 ("JSF AV"). A conformance
//              effort with one documented deviation, not a certified compliance; see
//              STANDARD.md and the deviation record in Resume_core.cpp.
// Module role: This module is the authoritative computation layer for robertbrucecoe.github.io.
//              It is compiled to a freestanding wasm32 module (no operating system, no C or C++
//              run-time library, no heap) and is invoked from the presentation layer.
//              The presentation layer is required to remain fully readable if this module is
//              absent; every export below is therefore an enhancement, never a gatekeeper.
// Comments:    Comments in this header describe externally visible behavior only. [AV Rule 129]
// Copyright:   (c) 2026 Robert Coe. All rights reserved.                          [AV Rule 133]
//------------------------------------------------------------------------------------------------

#ifndef RESUME_CORE_H                                                          // [AV Rule 27, 35]
#define RESUME_CORE_H

#include <Std_types.h>                                                         // [AV Rule 33, 37]

namespace Rbc                                                                  // [AV Rule 98]
{
  // All functions below use C language linkage so that their symbol names survive unmangled
  // as WebAssembly exports. C linkage does not exempt them from JSF AV conformance.
  extern "C"
  {
    // rb_init
    // Purpose:      Power-on initialization and continuous built-in test (BIT) of the module,
    //               mirroring the power-on self-test discipline of avionics line-replaceable
    //               units. Computes the CRC-32 of the canonical resume record and verifies
    //               every computational subsystem against known-answer tests.
    // Parameters:   current_year  - calendar year at page load (e.g. 2026); used to resolve
    //                               open-ended employment intervals.       [AV Rule 116]
    //               current_month - calendar month at page load, 1 through 12.
    // Returns:      0 when all built-in tests pass ("system nominal"); otherwise a bitmask
    //               of bit_failure_codes identifying each failed subsystem.
    // Assumptions:  Inputs outside their documented ranges are clamped, not trusted.
    //                                                                      [AV Rule 15, 134]
    int32 rb_init(int32 current_year, int32 current_month);

    // rb_bit_status
    // Purpose:      Report the result of the most recent built-in test without re-running it.
    // Returns:      The bitmask most recently produced by rb_init, or the dedicated
    //               not-initialized code if rb_init has never been called.
    int32 rb_bit_status();

    // rb_data_crc_octet
    // Purpose:      Expose the CRC-32 (IEEE 802.3 polynomial) of the canonical resume record
    //               one octet at a time, so the presentation layer can display the integrity
    //               word. The value is transported octet-by-octet, rather than as a single
    //               word, so that no conversion of an out-of-range unsigned value to a signed
    //               type ever occurs: every value returned lies in [0, 255] and is therefore
    //               representable in int32 with fully defined ISO C++ behavior.
    //                                                                      [AV Rule 8, 180]
    // Parameters:   octet_index - which octet to read, 0 (least significant) through 3.
    // Returns:      The selected octet in [0, 255], or 0 if octet_index is out of range.
    int32 rb_data_crc_octet(int32 octet_index);

    // rb_role_count
    // Purpose:      Report the number of professional roles in the canonical record.
    // Returns:      The role count (a small positive constant).
    int32 rb_role_count();

    // rb_role_months
    // Purpose:      Compute the inclusive duration, in whole months, of one professional role.
    //               Open-ended roles are resolved against the date supplied to rb_init.
    // Parameters:   role_index - zero-based role ordinal, newest role first.
    // Returns:      Duration in months, or 0 if role_index is out of range. [AV Rule 15]
    int32 rb_role_months(int32 role_index);

    // rb_service_months
    // Purpose:      Compute total months of uniformed military service in the canonical record.
    // Returns:      Total months across all military roles.
    int32 rb_service_months();

    // rb_ease
    // Purpose:      Deterministic integer smoothstep interpolation for presentation-layer
    //               counters. All arithmetic is signed 32-bit fixed point; no floating point
    //               exists anywhere in this module, so identical inputs yield identical
    //               outputs on every host.                                  [AV Rule 202]
    // Parameters:   elapsed  - milliseconds since the animation began; clamped to [0, duration].
    //               duration - animation length in milliseconds; values below 1 are treated as 1.
    //               start_value / end_value - interpolation endpoints; the caller limits their
    //               magnitude to one million, which the module also enforces by clamping.
    // Returns:      The interpolated value; exactly start_value at elapsed 0 and exactly
    //               end_value at elapsed >= duration.
    // Assumptions:  Endpoint magnitudes are bounded so that every intermediate product fits
    //               within int32 without overflow.                          [AV Rule 203, 134]
    int32 rb_ease(int32 elapsed,
                  int32 duration,
                  int32 start_value,
                  int32 end_value);                                          // [AV Rule 58, 110]

    // rb_section_reset
    // Purpose:      Clear the section threshold table in preparation for a fresh sequence of
    //               rb_section_push calls. The table is statically allocated and the host
    //               never receives its address: every write passes through rb_section_push,
    //               so no code outside this module can reach the module's memory. [AV Rule 207]
    // Returns:      0.
    int32 rb_section_reset();

    // rb_section_push
    // Purpose:      Append one section's top offset to the threshold table. This is how the
    //               presentation layer feeds the navigation state machine, by value, without
    //               any shared-memory aliasing.
    // Parameters:   section_top - vertical offset of a section's top edge, in CSS pixels.
    // Returns:      1 if the offset was accepted; 0 if the fixed-capacity table is already
    //               full (the push is then ignored, never overruns).        [AV Rule 15]
    int32 rb_section_push(int32 section_top);

    // rb_active_section
    // Purpose:      Resolve which page section is active for a given scroll position by
    //               evaluating the pushed threshold table as a monotonic sequence. This is
    //               the navigation state machine for the presentation layer.
    // Parameters:   scroll_position - current vertical scroll offset in CSS pixels.
    // Returns:      Zero-based index of the active section; 0 when no entry qualifies.
    int32 rb_active_section(int32 scroll_position);
  }
}

#endif // RESUME_CORE_H
