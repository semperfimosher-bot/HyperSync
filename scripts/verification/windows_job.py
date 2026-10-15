"""Own Windows descendants even after their initial process exits."""

import ctypes
from ctypes import wintypes


class BasicLimits(ctypes.Structure):
    _fields_ = [
        ('ProcessUserTime', ctypes.c_int64), ('JobUserTime', ctypes.c_int64),
        ('Flags', wintypes.DWORD), ('MinimumWorkingSet', ctypes.c_size_t),
        ('MaximumWorkingSet', ctypes.c_size_t), ('ActiveProcesses', wintypes.DWORD),
        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD),
        ('SchedulingClass', wintypes.DWORD),
    ]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        'ReadOperations', 'WriteOperations', 'OtherOperations',
        'ReadBytes', 'WriteBytes', 'OtherBytes',
    )]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ('Basic', BasicLimits), ('Io', IoCounters),
        ('ProcessMemory', ctypes.c_size_t), ('JobMemory', ctypes.c_size_t),
        ('PeakProcessMemory', ctypes.c_size_t), ('PeakJobMemory', ctypes.c_size_t),
    ]


# These ctypes APIs exist only on Windows; this module is imported there only.
# Dynamic lookup lets the rest of the runner type-check on Linux/macOS too.
_WIN_DLL = "WinDLL"
_WIN_ERROR = "WinError"
_LAST_ERROR = "get_last_error"


class WindowsJob:
    def __init__(self):
        kernel = getattr(ctypes, _WIN_DLL)('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel = kernel
        self.handle = kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise getattr(ctypes, _WIN_ERROR)(getattr(ctypes, _LAST_ERROR)())
        limits = ExtendedLimits()
        limits.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits),
                                             ctypes.sizeof(limits)):
            self.close()
            raise getattr(ctypes, _WIN_ERROR)(getattr(ctypes, _LAST_ERROR)())

    def assign_and_resume(self, process_handle):
        if not self.kernel.AssignProcessToJobObject(self.handle, int(process_handle)):
            raise getattr(ctypes, _WIN_ERROR)(getattr(ctypes, _LAST_ERROR)())
        ntdll = getattr(ctypes, _WIN_DLL)('ntdll')
        ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
        ntdll.NtResumeProcess.restype = ctypes.c_long
        if ntdll.NtResumeProcess(int(process_handle)) != 0:
            raise OSError('Could not resume owned verification process')

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
