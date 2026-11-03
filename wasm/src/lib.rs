//! Small, dependency-free client matching kernel. Text is Unicode-lowercased by the JS boundary.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
/// # Safety
/// The pointer and length must come from alloc, and be freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
/// # Safety
/// Both pointer/length pairs must describe allocated, readable memory.
#[no_mangle]
pub unsafe extern "C" fn contains(haystack: *const u8, haystack_len: usize, needle: *const u8, needle_len: usize) -> i32 {
    let h = std::slice::from_raw_parts(haystack, haystack_len);
    let n = std::slice::from_raw_parts(needle, needle_len);
    i32::from(n.is_empty() || h.windows(n.len()).any(|part| part == n))
}
#[no_mangle]
pub extern "C" fn salary_meets(minimum: f64, floor: f64) -> i32 {
    i32::from(minimum.is_finite() && floor.is_finite() && minimum > 0.0 && floor > 0.0 && minimum >= floor)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pay_floor() {assert_eq!(salary_meets(100_000.0, 100_000.0), 1);assert_eq!(salary_meets(90_000.0,100_000.0),0);assert_eq!(salary_meets(f64::NAN,1.0),0);}
    #[test]
    fn text_match() {unsafe {assert_eq!(contains(b"javascript".as_ptr(),10,b"script".as_ptr(),6),1);assert_eq!(contains(b"rust".as_ptr(),4,b"python".as_ptr(),6),0);}}
}
