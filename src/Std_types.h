//------------------------------------------------------------------------------------------------
// File:        Std_types.h
// Contents:    Specific-length type definitions for the RBC-1 resume logic module.
// Standard:    Written to the discipline of the Joint Strike Fighter Air Vehicle C++ Coding
//              Standards, Doc. No. 2RDU00001 Rev C, December 2005 ("JSF AV"). A conformance
//              effort with one documented deviation, not a certified compliance; see
//              STANDARD.md and the deviation record in Resume_core.cpp.
// Rationale:   AV Rule 209 requires that the basic types int, short, long, float and double
//              not be used directly; specific-length equivalents are typedef'd here for the
//              wasm32 target and these names are used throughout the code.
// Target:      wasm32 (ILP32): char is 8 bits, short is 16 bits, int is 32 bits.
// Copyright:   (c) 2026 Robert Coe. All rights reserved.                          [AV Rule 133]
//------------------------------------------------------------------------------------------------

#ifndef STD_TYPES_H                                                            // [AV Rule 27, 35]
#define STD_TYPES_H

namespace Rbc                                                                  // [AV Rule 98]
{
  typedef signed char    int8;     // 8-bit signed integer                        [AV Rule 209]
  typedef unsigned char  uint8;    // 8-bit unsigned integer; used to widen bytes to bit
                                   // vectors without sign extension               [AV Rule 209]
  typedef short          int16;    // 16-bit signed integer                       [AV Rule 209]
  typedef int            int32;    // 32-bit signed integer                       [AV Rule 209]
  typedef unsigned int   uint32;   // 32-bit unsigned integer; reserved for bitwise (modulo-2
                                   // polynomial) operations only -- see the deviation record
                                   // for AV Rule 163 in Resume_core.cpp          [AV Rule 209]

  // Compile-time verification that the typedefs above have the widths their names promise.
  // The array types below are ill-formed (negative bound) if any width assumption is false,
  // forcing a compile-time diagnostic rather than a run-time fault.            [AV Rule 217]
  // A typedef'd array is used because ISO/IEC 14882:2002 provides no static_assert and
  // AV Rule 26 forbids the pre-processor macros that classic assertion idioms require.
  typedef char Int8_width_check[(sizeof(int8) == 1) ? 1 : -1];     // int8 must be 1 byte
  typedef char Uint8_width_check[(sizeof(uint8) == 1) ? 1 : -1];   // uint8 must be 1 byte
  typedef char Int16_width_check[(sizeof(int16) == 2) ? 1 : -1];   // int16 must be 2 bytes
  typedef char Int32_width_check[(sizeof(int32) == 4) ? 1 : -1];   // int32 must be 4 bytes
  typedef char Uint32_width_check[(sizeof(uint32) == 4) ? 1 : -1]; // uint32 must be 4 bytes
}

#endif // STD_TYPES_H
